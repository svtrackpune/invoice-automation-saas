-- 9+ production hardening for payment links and notification delivery.
-- Keeps external payment creation, gateway reconciliation, and reminder delivery
-- idempotent at the database boundary.

ALTER TABLE public.payment_links DROP CONSTRAINT IF EXISTS payment_links_status_check;
ALTER TABLE public.payment_links
  ADD CONSTRAINT payment_links_status_check
  CHECK (status = ANY (ARRAY[
    'creating'::text,
    'created'::text,
    'partially_paid'::text,
    'paid'::text,
    'expired'::text,
    'cancelled'::text,
    'failed'::text
  ]));

CREATE OR REPLACE FUNCTION public.guard_payment_link_invoice_status()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=public,mm_private
AS $$
DECLARE
  v_status text;
BEGIN
  SELECT status::text INTO v_status
  FROM public.invoices
  WHERE id=NEW.invoice_id AND business_id=NEW.business_id;

  IF v_status IS NULL THEN
    RAISE EXCEPTION 'Payment link invoice not found';
  END IF;

  IF v_status NOT IN ('sent','posted','partially_paid','overdue') THEN
    RAISE EXCEPTION 'Payment links require a posted or billable invoice';
  END IF;

  RETURN NEW;
END;
$$;

DROP INDEX IF EXISTS public.payment_links_one_active_per_invoice_uidx;
CREATE UNIQUE INDEX payment_links_one_active_per_invoice_uidx
ON public.payment_links(business_id,invoice_id)
WHERE status IN ('creating','created','paid','partially_paid');

-- Provider transaction identifiers are globally unique. Enforce that property
-- locally as well, not merely within one tenant.
DROP INDEX IF EXISTS public.payments_business_gateway_transaction_uidx;
CREATE UNIQUE INDEX payments_gateway_transaction_uidx
ON public.payments(gateway_transaction_id)
WHERE gateway_transaction_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.record_gateway_payment(
  p_provider text,
  p_provider_link_id text,
  p_provider_transaction_id text,
  p_event_id text,
  p_amount numeric,
  p_payment_date date DEFAULT CURRENT_DATE,
  p_notes text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public','mm_private'
AS $function$
DECLARE
  v_link public.payment_links%rowtype;
  v_inv public.invoices%rowtype;
  v_payment uuid;
  v_receipt uuid;
  v_entry uuid;
  v_ar uuid;
  v_account uuid;
  v_allocated numeric;
  v_receipt_number text;
BEGIN
  IF lower(coalesce(p_provider,'')) <> 'razorpay' THEN
    RAISE EXCEPTION 'Unsupported payment provider';
  END IF;
  IF nullif(trim(p_provider_link_id),'') IS NULL THEN
    RAISE EXCEPTION 'Provider link id is required';
  END IF;
  IF nullif(trim(p_provider_transaction_id),'') IS NULL THEN
    RAISE EXCEPTION 'Provider transaction id is required';
  END IF;
  IF p_amount <= 0 THEN
    RAISE EXCEPTION 'Payment amount must be greater than zero';
  END IF;

  -- Serialize all attempts for one provider transaction before any balance
  -- check or insert. This protects against concurrent webhook deliveries.
  PERFORM pg_advisory_xact_lock(
    hashtext('gateway-transaction:' || lower(p_provider) || ':' || p_provider_transaction_id)
  );

  SELECT id INTO v_payment
  FROM public.payments
  WHERE gateway_transaction_id=p_provider_transaction_id
  LIMIT 1;

  IF v_payment IS NOT NULL THEN
    SELECT id INTO v_receipt
    FROM public.receipts
    WHERE payment_id=v_payment
    LIMIT 1;
    RETURN coalesce(v_receipt,v_payment);
  END IF;

  SELECT * INTO v_link
  FROM public.payment_links
  WHERE provider='razorpay'
    AND provider_link_id=p_provider_link_id
  FOR UPDATE;

  IF v_link.id IS NULL THEN
    RAISE EXCEPTION 'Payment link not found';
  END IF;

  SELECT * INTO v_inv
  FROM public.invoices
  WHERE id=v_link.invoice_id
    AND business_id=v_link.business_id
  FOR UPDATE;

  IF v_inv.id IS NULL THEN
    RAISE EXCEPTION 'Invoice not found';
  END IF;
  IF v_inv.status='void' THEN
    RAISE EXCEPTION 'Cannot record payment for void invoice';
  END IF;
  IF v_inv.journal_entry_id IS NULL THEN
    RAISE EXCEPTION 'Invoice must be posted before gateway payment';
  END IF;
  IF p_amount > greatest(v_inv.balance_due,0) THEN
    RAISE EXCEPTION 'Payment exceeds invoice balance';
  END IF;

  SELECT id INTO v_account
  FROM public.accounts
  WHERE business_id=v_link.business_id AND code='1010' AND is_active
  LIMIT 1;
  IF v_account IS NULL THEN
    RAISE EXCEPTION 'Gateway payment account is missing';
  END IF;

  SELECT id INTO v_ar
  FROM public.accounts
  WHERE business_id=v_link.business_id AND code='1100' AND is_active
  LIMIT 1;
  IF v_ar IS NULL THEN
    RAISE EXCEPTION 'Accounts receivable account is missing';
  END IF;

  INSERT INTO public.payments(
    business_id,direction,customer_id,invoice_id,account_id,amount,currency_code,
    payment_date,method,reference,gateway_transaction_id,notes,created_by
  ) VALUES (
    v_link.business_id,'inbound',v_inv.customer_id,v_inv.id,v_account,p_amount,
    v_inv.currency_code,p_payment_date,'payment_gateway'::public.payment_method,
    coalesce(p_provider_transaction_id,p_event_id),p_provider_transaction_id,
    coalesce(p_notes,'Gateway payment: '||p_provider),NULL
  ) RETURNING id INTO v_payment;

  INSERT INTO public.payment_allocations(business_id,payment_id,invoice_id,amount)
  VALUES(v_link.business_id,v_payment,v_inv.id,p_amount);

  PERFORM pg_advisory_xact_lock(hashtext('journal-entry-number:'||v_link.business_id::text));

  INSERT INTO public.journal_entries(
    business_id,entry_number,entry_date,description,source_type,source_id,status,
    posted_at,posted_by,created_by,currency_code,total_debit,total_credit,is_system_generated
  ) VALUES(
    v_link.business_id,
    (SELECT coalesce(max(entry_number),0)+1
     FROM public.journal_entries
     WHERE business_id=v_link.business_id),
    p_payment_date,
    'Gateway payment for invoice '||v_inv.invoice_number,
    'payment',v_payment,'posted',now(),NULL,NULL,v_inv.currency_code,p_amount,p_amount,true
  ) RETURNING id INTO v_entry;

  INSERT INTO public.journal_lines(
    journal_entry_id,account_id,description,debit,credit,currency_code,entity_type,entity_id
  ) VALUES
    (v_entry,v_account,'Gateway customer payment',p_amount,0,v_inv.currency_code,'customer',v_inv.customer_id),
    (v_entry,v_ar,'Receivable settlement',0,p_amount,v_inv.currency_code,'customer',v_inv.customer_id);

  PERFORM public.validate_journal_entry_balance(v_entry);
  UPDATE public.payments SET journal_entry_id=v_entry WHERE id=v_payment;

  SELECT coalesce(sum(pa.amount),0)
  INTO v_allocated
  FROM public.payment_allocations pa
  WHERE pa.invoice_id=v_inv.id;

  UPDATE public.invoices
  SET amount_paid=v_allocated,
      balance_due=greatest(total-v_allocated,0),
      status=CASE
        WHEN v_allocated>=total THEN 'paid'::invoice_status
        WHEN v_allocated>0 AND due_date<current_date THEN 'overdue'::invoice_status
        WHEN v_allocated>0 THEN 'partially_paid'::invoice_status
        WHEN due_date<current_date THEN 'overdue'::invoice_status
        ELSE 'sent'::invoice_status
      END,
      updated_at=now()
  WHERE id=v_inv.id;

  v_receipt_number:=public.next_document_number(v_link.business_id,'receipt');

  INSERT INTO public.receipts(
    business_id,customer_id,payment_id,receipt_number,receipt_date,amount,currency_code,
    payment_method,reference_number,notes,created_by
  ) VALUES(
    v_link.business_id,v_inv.customer_id,v_payment,v_receipt_number,p_payment_date,p_amount,
    v_inv.currency_code,'payment_gateway',p_provider_transaction_id,p_notes,NULL
  ) RETURNING id INTO v_receipt;

  RETURN v_receipt;
END;
$function$;

REVOKE ALL ON FUNCTION public.record_gateway_payment(text,text,text,text,numeric,date,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.record_gateway_payment(text,text,text,text,numeric,date,text) TO service_role;

CREATE UNIQUE INDEX IF NOT EXISTS notification_jobs_idempotency_uidx
ON public.notification_jobs(
  business_id,
  channel,
  notification_type,
  (metadata->>'idempotency_key')
)
WHERE metadata ? 'idempotency_key';

CREATE OR REPLACE FUNCTION public.enqueue_payment_link_notification(
  p_business_id uuid,
  p_payment_link_id uuid
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=public,mm_private
AS $function$
DECLARE
  pl record;
  n integer:=0;
  msg text;
BEGIN
  IF NOT mm_private.has_business_permission(p_business_id,'payments.receive') THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  SELECT pl.*,i.invoice_number,i.customer_id,c.display_name,c.email,c.phone
  INTO pl
  FROM public.payment_links pl
  JOIN public.invoices i ON i.id=pl.invoice_id
  JOIN public.customers c ON c.id=i.customer_id
  WHERE pl.id=p_payment_link_id AND pl.business_id=p_business_id;

  IF pl.id IS NULL THEN
    RAISE EXCEPTION 'Payment link not found';
  END IF;

  msg:='Payment link for invoice '||pl.invoice_number||': '||coalesce(pl.short_url,'');

  IF pl.email IS NOT NULL THEN
    INSERT INTO public.notification_jobs(
      business_id,customer_id,invoice_id,channel,notification_type,recipient,subject,message,
      action_url,metadata
    ) VALUES(
      p_business_id,pl.customer_id,pl.invoice_id,'email','payment_link',pl.email,
      'Payment link · '||pl.invoice_number,msg,pl.short_url,
      jsonb_build_object('payment_link_id',pl.id,'idempotency_key','payment_link:'||pl.id||':email')
    ) ON CONFLICT DO NOTHING;
    n:=n+1;
  END IF;

  IF pl.phone IS NOT NULL THEN
    INSERT INTO public.notification_jobs(
      business_id,customer_id,invoice_id,channel,notification_type,recipient,subject,message,
      action_url,metadata
    ) VALUES(
      p_business_id,pl.customer_id,pl.invoice_id,'whatsapp',pl.phone,
      'payment_link',pl.phone,NULL,msg,pl.short_url,
      jsonb_build_object('payment_link_id',pl.id,'idempotency_key','payment_link:'||pl.id||':whatsapp')
    ) ON CONFLICT DO NOTHING;
    n:=n+1;
  END IF;

  RETURN n;
END;
$function$;

CREATE OR REPLACE FUNCTION public.enqueue_invoice_reminders(
  p_business_id uuid,
  p_now timestamptz DEFAULT now()
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=public,mm_private
AS $function$
DECLARE
  n integer:=0;
  inv record;
  due_days integer;
  target timestamptz;
  body text;
  kind text;
BEGIN
  IF NOT mm_private.has_business_permission(p_business_id,'payments.receive') THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  FOR inv IN
    SELECT i.id,i.invoice_number,i.customer_id,i.due_date,i.balance_due,i.currency_code,
           c.display_name,c.email,c.phone,c.payment_reminders_enabled,c.reminder_days_before_due
    FROM public.invoices i
    JOIN public.customers c ON c.id=i.customer_id AND c.business_id=i.business_id
    WHERE i.business_id=p_business_id
      AND i.status IN ('sent','partially_paid','overdue')
      AND i.balance_due>0
      AND c.payment_reminders_enabled
      AND (c.email IS NOT NULL OR c.phone IS NOT NULL)
  LOOP
    due_days:=greatest(coalesce(inv.reminder_days_before_due,3),0);
    target:=(inv.due_date::timestamptz - make_interval(days=>due_days));

    IF p_now>=target THEN
      kind:=CASE WHEN inv.due_date<p_now::date THEN 'overdue' ELSE 'due_soon' END;
      body:=CASE
        WHEN kind='overdue' THEN
          'Payment reminder: invoice '||inv.invoice_number||' is overdue. Outstanding balance: '||
          inv.balance_due||' '||inv.currency_code||'.'
        ELSE
          'Payment reminder: invoice '||inv.invoice_number||' is due on '||inv.due_date||
          '. Outstanding balance: '||inv.balance_due||' '||inv.currency_code||'.'
      END;

      IF inv.email IS NOT NULL THEN
        INSERT INTO public.notification_jobs(
          business_id,customer_id,invoice_id,channel,notification_type,recipient,subject,message,
          scheduled_for,metadata
        ) VALUES(
          p_business_id,inv.customer_id,inv.id,'email',kind,inv.email,
          'Payment reminder · '||inv.invoice_number,body,p_now,
          jsonb_build_object(
            'invoice_number',inv.invoice_number,
            'idempotency_key','invoice:'||inv.id||':'||kind||':'||inv.due_date||':email'
          )
        ) ON CONFLICT DO NOTHING;
        n:=n+1;
      END IF;

      IF inv.phone IS NOT NULL THEN
        INSERT INTO public.notification_jobs(
          business_id,customer_id,invoice_id,channel,notification_type,recipient,subject,message,
          scheduled_for,metadata
        ) VALUES(
          p_business_id,inv.customer_id,inv.id,'whatsapp',kind,inv.phone,
          NULL,body,p_now,
          jsonb_build_object(
            'invoice_number',inv.invoice_number,
            'idempotency_key','invoice:'||inv.id||':'||kind||':'||inv.due_date||':whatsapp'
          )
        ) ON CONFLICT DO NOTHING;
        n:=n+1;
      END IF;
    END IF;
  END LOOP;

  RETURN n;
END;
$function$;
