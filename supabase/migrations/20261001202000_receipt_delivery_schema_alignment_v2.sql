BEGIN;

-- Customer-provided contact details must make automated receipt delivery eligible.
-- Payment reminders remain separately disabled for the special counter customer.
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

  SELECT id
  INTO v_id
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
      notify_customer,notify_owner,product_reminder_after_unit,service_reminder_after_unit
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
      true,
      false,
      'days',
      'days'
    )
    RETURNING id INTO v_id;
  ELSE
    UPDATE public.customers
    SET notify_customer = true,
        updated_at = now()
    WHERE id = v_id
      AND business_id = p_business_id;
  END IF;

  RETURN v_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.sync_notification_delivery_evidence()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  INSERT INTO public.notification_delivery_evidence (
    business_id, notification_job_id, channel,
    recipient, subject, message, content_hash, provider_message_id, status,
    queued_at, sent_at, metadata, created_at
  ) VALUES (
    NEW.business_id,
    NEW.id,
    NEW.channel,
    NEW.recipient,
    NEW.subject,
    NEW.message,
    encode(extensions.digest(coalesce(NEW.message,''), 'sha256'), 'hex'),
    NEW.provider_message_id,
    NEW.status,
    NEW.scheduled_for,
    NEW.sent_at,
    jsonb_build_object(
      'notification_type', NEW.notification_type,
      'action_url', NEW.action_url,
      'attempts', NEW.attempts,
      'last_error', NEW.last_error,
      'source', 'notification_jobs'
    ),
    coalesce(NEW.created_at, now())
  )
  ON CONFLICT (notification_job_id) WHERE notification_job_id IS NOT NULL
  DO UPDATE SET
    channel = EXCLUDED.channel,
    recipient = EXCLUDED.recipient,
    subject = EXCLUDED.subject,
    message = EXCLUDED.message,
    content_hash = EXCLUDED.content_hash,
    provider_message_id = EXCLUDED.provider_message_id,
    status = EXCLUDED.status,
    queued_at = EXCLUDED.queued_at,
    sent_at = EXCLUDED.sent_at,
    delivered_at = CASE
      WHEN EXCLUDED.status IN ('delivered','success')
        THEN coalesce(public.notification_delivery_evidence.delivered_at, now())
      ELSE public.notification_delivery_evidence.delivered_at
    END,
    metadata = EXCLUDED.metadata;
  RETURN NEW;
END;
$function$;

COMMIT;
