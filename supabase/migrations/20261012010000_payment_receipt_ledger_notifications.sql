BEGIN;

-- Use the invoice ledger as the authoritative, live customer outstanding balance.
-- This is an internal helper: a business/customer UUID pair is not a public
-- authorization token, so anonymous and authenticated clients must not execute it.
CREATE OR REPLACE FUNCTION public.fn_get_customer_outstanding_balance(
  p_business_id uuid,
  p_customer_id uuid
)
RETURNS numeric(15,2)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
  SELECT round(coalesce(sum(coalesce(i.balance_due, 0)), 0), 2)::numeric(15,2)
  FROM public.invoices i
  WHERE i.business_id = p_business_id
    AND i.customer_id = p_customer_id
    AND i.status::text NOT IN ('draft', 'void', 'cancelled');
$function$;

REVOKE ALL ON FUNCTION public.fn_get_customer_outstanding_balance(uuid,uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_get_customer_outstanding_balance(uuid,uuid)
  TO service_role;

-- Existing payment entry points already mint receipts explicitly. The deferred
-- trigger below therefore sees those receipts after the payment RPC finishes,
-- and creates a receipt only for inbound payments that would otherwise lack one.
-- The live database was audited: no payment_id duplicates currently exist.
CREATE UNIQUE INDEX IF NOT EXISTS receipts_payment_id_uidx
  ON public.receipts(payment_id)
  WHERE payment_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.fn_on_payment_settled_notify()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, mm_private, pg_temp
AS $function$
DECLARE
  v_customer_id uuid;
  v_receipt_id uuid;
  v_receipt_number text;
BEGIN
  -- public.payments is the finalized financial ledger; it has no status column.
  -- Only committed inbound payment rows represent received customer funds.
  IF NEW.direction::text <> 'inbound' THEN
    RETURN NEW;
  END IF;

  SELECT r.id INTO v_receipt_id
  FROM public.receipts r
  WHERE r.payment_id = NEW.id
    AND r.business_id = NEW.business_id
  ORDER BY r.created_at
  LIMIT 1;

  IF v_receipt_id IS NOT NULL THEN
    RETURN NEW;
  END IF;

  -- Keep the customer inside the payment's tenant. Fall back to its linked
  -- invoice for imports/reconciliation paths that omit payments.customer_id.
  SELECT c.id INTO v_customer_id
  FROM public.customers c
  WHERE c.id = NEW.customer_id
    AND c.business_id = NEW.business_id
    AND c.is_active;

  IF v_customer_id IS NULL AND NEW.invoice_id IS NOT NULL THEN
    SELECT i.customer_id INTO v_customer_id
    FROM public.invoices i
    JOIN public.customers c
      ON c.id = i.customer_id
     AND c.business_id = i.business_id
    WHERE i.id = NEW.invoice_id
      AND i.business_id = NEW.business_id;
  END IF;

  v_receipt_number := public.next_document_number(NEW.business_id, 'receipt');

  INSERT INTO public.receipts(
    business_id, customer_id, payment_id, receipt_number, receipt_date,
    amount, currency_code, payment_method, reference_number, notes, created_by
  )
  VALUES(
    NEW.business_id, v_customer_id, NEW.id, v_receipt_number, NEW.payment_date,
    NEW.amount, NEW.currency_code, NEW.method::text, NEW.reference, NEW.notes, NEW.created_by
  )
  ON CONFLICT (payment_id) WHERE payment_id IS NOT NULL DO NOTHING
  RETURNING id INTO v_receipt_id;

  IF v_receipt_id IS NULL THEN
    SELECT r.id INTO v_receipt_id
    FROM public.receipts r
    WHERE r.payment_id = NEW.id
      AND r.business_id = NEW.business_id
    ORDER BY r.created_at
    LIMIT 1;
  END IF;

  IF v_receipt_id IS NULL THEN
    RAISE EXCEPTION 'Receipt could not be generated for inbound payment %', NEW.id;
  END IF;

  -- The receipt's deferred insert trigger mints the hashed bearer token and
  -- stages notifications after all invoice/allocation updates in this transaction.
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.fn_on_payment_settled_notify()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_on_payment_settled_notify()
  TO service_role;

DROP TRIGGER IF EXISTS trg_payment_settled_notify ON public.payments;
CREATE CONSTRAINT TRIGGER trg_payment_settled_notify
AFTER INSERT ON public.payments
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION public.fn_on_payment_settled_notify();

-- Stage receipt delivery at transaction commit so outstanding balances reflect
-- the final invoice/payment allocation state instead of a mid-RPC snapshot.
DROP TRIGGER IF EXISTS trg_enqueue_receipt_delivery_notifications ON public.receipts;
CREATE CONSTRAINT TRIGGER trg_enqueue_receipt_delivery_notifications
AFTER INSERT ON public.receipts
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION public.trg_enqueue_receipt_delivery_notifications();

-- A receipt dispatch fans out one idempotent outbox row per enabled, configured
-- customer channel. The existing worker resolves the opaque receipt token and
-- fetches the official PDF; WAPI/Telegram/email already attach the PDF bytes.
CREATE OR REPLACE FUNCTION public.enqueue_receipt_delivery_notifications(
  p_receipt_id uuid
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, mm_private, pg_temp
AS $function$
DECLARE
  r public.receipts%rowtype;
  c public.customers%rowtype;
  biz public.businesses%rowtype;
  prefs public.business_preferences%rowtype;
  v_access jsonb;
  v_token text;
  v_action_url text;
  v_outstanding numeric(15,2) := 0;
  v_invoice_id uuid;
  v_channel text;
  v_recipient text;
  v_subject text;
  v_body text;
  v_delivery_key text;
  v_metadata jsonb;
  v_inserted integer := 0;
  v_total_inserted integer := 0;
  v_channels text[] := ARRAY[]::text[];
BEGIN
  SELECT * INTO r
  FROM public.receipts
  WHERE id = p_receipt_id
  FOR UPDATE;

  IF r.id IS NULL THEN
    RAISE EXCEPTION 'Receipt not found';
  END IF;

  IF r.customer_id IS NULL THEN
    RETURN 0;
  END IF;

  SELECT * INTO c
  FROM public.customers
  WHERE id = r.customer_id
    AND business_id = r.business_id
    AND is_active;

  IF c.id IS NULL OR NOT coalesce(c.receipt_delivery_enabled, true) THEN
    RETURN 0;
  END IF;

  SELECT * INTO biz FROM public.businesses WHERE id = r.business_id;
  SELECT * INTO prefs FROM public.business_preferences WHERE business_id = r.business_id;

  SELECT p.invoice_id INTO v_invoice_id
  FROM public.payments p
  WHERE p.id = r.payment_id
    AND p.business_id = r.business_id;

  v_outstanding := public.fn_get_customer_outstanding_balance(r.business_id, r.customer_id);

  IF coalesce(prefs.notification_whatsapp_enabled, true)
     AND nullif(trim(coalesce(c.phone, '')), '') IS NOT NULL
     AND EXISTS (
       SELECT 1 FROM public.business_notification_connections nc
       WHERE nc.business_id = r.business_id
         AND nc.channel = 'whatsapp'
         AND nc.enabled
         AND nc.health_status <> 'failing'
     ) THEN
    v_channels := array_append(v_channels, 'whatsapp');
  END IF;

  IF coalesce(prefs.notification_email_enabled, true)
     AND nullif(trim(coalesce(c.email, '')), '') IS NOT NULL
     AND EXISTS (
       SELECT 1 FROM public.business_notification_connections nc
       WHERE nc.business_id = r.business_id
         AND nc.channel = 'email'
         AND nc.enabled
         AND nc.health_status <> 'failing'
     ) THEN
    v_channels := array_append(v_channels, 'email');
  END IF;

  IF coalesce(prefs.notification_sms_enabled, false)
     AND nullif(trim(coalesce(c.phone, '')), '') IS NOT NULL
     AND EXISTS (
       SELECT 1 FROM public.business_notification_connections nc
       WHERE nc.business_id = r.business_id
         AND nc.channel = 'sms'
         AND nc.enabled
         AND nc.health_status <> 'failing'
     ) THEN
    v_channels := array_append(v_channels, 'sms');
  END IF;

  IF coalesce(prefs.notification_telegram_enabled, false)
     AND nullif(trim(coalesce(c.telegram_chat_id, '')), '') IS NOT NULL
     AND EXISTS (
       SELECT 1 FROM public.business_notification_connections nc
       WHERE nc.business_id = r.business_id
         AND nc.channel = 'telegram'
         AND nc.enabled
         AND nc.health_status <> 'failing'
     ) THEN
    v_channels := array_append(v_channels, 'telegram');
  END IF;

  IF cardinality(v_channels) = 0 THEN
    RETURN 0;
  END IF;

  v_access := public._issue_receipt_access_token(r.id, 'customer_download');
  v_token := v_access->>'token';
  IF v_token IS NULL OR v_token !~ '^[A-Fa-f0-9]{48,128}$' THEN
    RAISE EXCEPTION 'Receipt public token could not be issued';
  END IF;

  v_action_url := '/api/receipts/pdf?token=' || v_token;
  v_body := 'Your payment receipt ' || r.receipt_number || ' from ' ||
    coalesce(biz.legal_name, biz.name, 'Business') || ' is ready. Customer outstanding balance: ' ||
    'INR ' || to_char(v_outstanding, 'FM999,999,999,990.00') || '.';

  FOREACH v_channel IN ARRAY v_channels LOOP
    v_recipient := CASE v_channel
      WHEN 'whatsapp' THEN trim(c.phone)
      WHEN 'email' THEN trim(c.email)
      WHEN 'sms' THEN trim(c.phone)
      WHEN 'telegram' THEN trim(c.telegram_chat_id)
      ELSE NULL
    END;
    v_subject := CASE
      WHEN v_channel IN ('email', 'telegram') THEN 'Payment receipt · ' || r.receipt_number
      ELSE NULL
    END;
    v_delivery_key := 'receipt:' || r.id::text || ':v5:' || v_channel;
    v_metadata := jsonb_build_object(
      'receipt_id', r.id,
      'receipt_number', r.receipt_number,
      'document_type', 'receipt',
      'document_id', r.id::text,
      'attachment_type', CASE WHEN v_channel = 'sms' THEN 'public_pdf_link' ELSE 'receipt_pdf' END,
      'attachment_filename', 'Receipt_' || r.receipt_number || '.pdf',
      'customer_outstanding_balance', v_outstanding,
      'idempotency_key', v_delivery_key,
      'delivery_idempotency_key', v_delivery_key,
      'attempted_channels', jsonb_build_array(v_channel),
      'delivery_attempt', 1
    );

    INSERT INTO public.notification_jobs(
      business_id, customer_id, invoice_id, channel, notification_type,
      recipient, subject, message, action_url, scheduled_for, metadata,
      delivery_idempotency_key
    )
    VALUES(
      r.business_id, r.customer_id, v_invoice_id, v_channel, 'receipt',
      v_recipient, v_subject, v_body, v_action_url, now(), v_metadata,
      v_delivery_key
    )
    ON CONFLICT (business_id, delivery_idempotency_key)
      WHERE delivery_idempotency_key IS NOT NULL
    DO NOTHING;

    GET DIAGNOSTICS v_inserted = ROW_COUNT;
    v_total_inserted := v_total_inserted + v_inserted;
  END LOOP;

  RETURN v_total_inserted;
END;
$function$;

REVOKE ALL ON FUNCTION public.enqueue_receipt_delivery_notifications(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_receipt_delivery_notifications(uuid)
  TO service_role;

COMMENT ON FUNCTION public.fn_get_customer_outstanding_balance(uuid,uuid) IS
  'Internal live customer balance from non-draft, non-void and non-cancelled invoices; not directly callable by public clients.';
COMMENT ON FUNCTION public.fn_on_payment_settled_notify() IS
  'Deferred payment trigger: ensures every inbound ledger payment has one receipt after payment/allocation updates commit.';
COMMENT ON FUNCTION public.enqueue_receipt_delivery_notifications(uuid) IS
  'Stages one idempotent receipt PDF notification per enabled channel with a hashed public receipt token and live outstanding-balance snapshot.';

COMMIT;
