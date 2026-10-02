BEGIN;

ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS receipt_delivery_enabled boolean NOT NULL DEFAULT true;

CREATE INDEX IF NOT EXISTS idx_customers_business_receipt_delivery
  ON public.customers(business_id, receipt_delivery_enabled);

CREATE OR REPLACE FUNCTION public.get_or_create_cash_customer_by_phone(
  p_business_id uuid,
  p_phone text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, mm_private
AS $function$
DECLARE
  v_phone text := trim(coalesce(p_phone,''));
  v_id uuid;
BEGIN
  IF NOT (
    mm_private.has_business_permission(p_business_id,'customers.manage')
    OR mm_private.has_business_permission(p_business_id,'sales.create')
  ) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  IF v_phone = '' THEN
    RAISE EXCEPTION 'Customer mobile number is required';
  END IF;

  SELECT id INTO v_id
  FROM public.customers
  WHERE business_id = p_business_id
    AND is_active = true
    AND phone = v_phone
  ORDER BY created_at
  LIMIT 1;

  IF v_id IS NULL THEN
    INSERT INTO public.customers(
      business_id,display_name,legal_name,email,phone,tax_id,tax_type,
      billing_address,shipping_address,credit_limit,payment_terms_days,notes,
      metadata,is_active,payment_reminders_enabled,reminder_days_before_due,
      default_discount_type,default_discount_value,relationship_type,
      product_reminder_after_days,service_recurring,service_recurring_interval,
      service_auto_invoice_days_before,service_reminder_after_days,
      notify_customer,notify_owner,receipt_delivery_enabled,
      product_reminder_after_unit,service_reminder_after_unit
    )
    VALUES(
      p_business_id,
      'Cash Customer · ' || v_phone,
      'Cash Customer · ' || v_phone,
      null,
      v_phone,
      null,
      'N/A',
      '{}'::jsonb,
      '{}'::jsonb,
      0,
      0,
      'Counter customer identified by mobile number.',
      '{"system":"cash_bill","source":"mobile"}'::jsonb,
      true,
      false,
      0,
      'none',
      0,
      'both',
      0,
      false,
      'monthly',
      0,
      0,
      false,
      false,
      true,
      'days',
      'days'
    )
    RETURNING id INTO v_id;
  ELSE
    UPDATE public.customers
    SET receipt_delivery_enabled = true,
        updated_at = now()
    WHERE id = v_id
      AND business_id = p_business_id;
  END IF;

  RETURN v_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.enqueue_receipt_delivery_notifications(
  p_receipt_id uuid
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, mm_private
AS $function$
DECLARE
  r public.receipts%rowtype;
  c public.customers%rowtype;
  b public.business_preferences%rowtype;
  biz public.businesses%rowtype;
  access jsonb;
  token text;
  action_url text;
  body text;
  invoice_id uuid;
  selected_channel text;
  selected_recipient text;
  selected_subject text;
  selected_metadata jsonb;
  queued integer := 0;
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
  SELECT * INTO b FROM public.business_preferences WHERE business_id = r.business_id;

  SELECT p.invoice_id INTO invoice_id
  FROM public.payments p
  WHERE p.id = r.payment_id
    AND p.business_id = r.business_id;

  access := public._issue_receipt_access_token(r.id, 'customer_download');
  token := access->>'token';
  action_url := '/api/receipts/pdf?token=' || token;
  body := 'Your payment receipt ' || r.receipt_number || ' from ' ||
          coalesce(biz.name, 'Business') || ' is ready.';

  -- Automatic receipt routing is deliberately one channel per event.
  -- WhatsApp is the primary digital channel when a phone is present and the
  -- business has enabled it. Other channels provide deterministic fallbacks.
  IF coalesce(b.notification_whatsapp_enabled, true)
     AND nullif(trim(coalesce(c.phone,'')), '') IS NOT NULL THEN
    selected_channel := 'whatsapp';
    selected_recipient := trim(c.phone);
    selected_subject := NULL;
    selected_metadata := jsonb_build_object(
      'receipt_id', r.id,
      'receipt_number', r.receipt_number,
      'attachment_type', 'receipt_pdf',
      'attachment_filename', 'receipt-' || r.receipt_number || '.pdf',
      'idempotency_key', 'receipt:' || r.id || ':whatsapp:v1'
    );
  ELSIF coalesce(b.notification_email_enabled, true)
     AND nullif(trim(coalesce(c.email,'')), '') IS NOT NULL THEN
    selected_channel := 'email';
    selected_recipient := trim(c.email);
    selected_subject := 'Payment receipt · ' || r.receipt_number;
    selected_metadata := jsonb_build_object(
      'receipt_id', r.id,
      'receipt_number', r.receipt_number,
      'attachment_type', 'receipt_pdf',
      'attachment_filename', 'receipt-' || r.receipt_number || '.pdf',
      'idempotency_key', 'receipt:' || r.id || ':email:v1'
    );
  ELSIF coalesce(b.notification_sms_enabled, false)
     AND nullif(trim(coalesce(c.phone,'')), '') IS NOT NULL THEN
    selected_channel := 'sms';
    selected_recipient := trim(c.phone);
    selected_subject := NULL;
    selected_metadata := jsonb_build_object(
      'receipt_id', r.id,
      'receipt_number', r.receipt_number,
      'delivery_format', 'link',
      'idempotency_key', 'receipt:' || r.id || ':sms:v1'
    );
  ELSIF coalesce(b.notification_telegram_enabled, false)
     AND nullif(trim(coalesce(c.telegram_chat_id,'')), '') IS NOT NULL THEN
    selected_channel := 'telegram';
    selected_recipient := trim(c.telegram_chat_id);
    selected_subject := 'Payment receipt · ' || r.receipt_number;
    selected_metadata := jsonb_build_object(
      'receipt_id', r.id,
      'receipt_number', r.receipt_number,
      'attachment_type', 'receipt_pdf',
      'attachment_filename', 'receipt-' || r.receipt_number || '.pdf',
      'idempotency_key', 'receipt:' || r.id || ':telegram:v1'
    );
  ELSE
    RETURN 0;
  END IF;

  INSERT INTO public.notification_jobs(
    business_id,
    customer_id,
    invoice_id,
    channel,
    notification_type,
    recipient,
    subject,
    message,
    action_url,
    scheduled_for,
    metadata
  )
  VALUES(
    r.business_id,
    r.customer_id,
    invoice_id,
    selected_channel,
    'receipt',
    selected_recipient,
    selected_subject,
    body,
    action_url,
    now(),
    selected_metadata
  )
  ON CONFLICT DO NOTHING;

  GET DIAGNOSTICS queued = ROW_COUNT;
  RETURN queued;
END;
$function$;

COMMIT;
