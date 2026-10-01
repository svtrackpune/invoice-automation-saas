BEGIN;

CREATE OR REPLACE FUNCTION public.sync_notification_delivery_evidence()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  INSERT INTO public.notification_delivery_evidence (
    business_id,
    notification_job_id,
    channel,
    recipient,
    subject,
    message,
    content_hash,
    provider_message_id,
    status,
    queued_at,
    sent_at,
    metadata,
    created_at
  )
  VALUES (
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
    metadata = EXCLUDED.metadata;

  RETURN NEW;
END;
$function$;

COMMIT;
