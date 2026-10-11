BEGIN;

-- notification_delivery_evidence has a partial unique index on
-- (notification_job_id, attempt_no) WHERE notification_job_id IS NOT NULL.
-- Without that predicate the AFTER trigger's UPSERT cannot infer its arbiter
-- and every notification_jobs insert fails, rolling back token/job creation.
CREATE OR REPLACE FUNCTION public.sync_notification_delivery_evidence()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_attempt_no integer := greatest(coalesce((NEW.metadata->>'delivery_attempt')::integer, 1), 1);
BEGIN
  INSERT INTO public.notification_delivery_evidence(
    business_id, notification_job_id, channel, recipient, subject, message,
    content_hash, provider_message_id, status, queued_at, sent_at, metadata,
    created_at, attempt_no
  )
  VALUES(
    NEW.business_id, NEW.id, NEW.channel, NEW.recipient, NEW.subject, NEW.message,
    encode(extensions.digest(coalesce(NEW.message,''), 'sha256'), 'hex'),
    NEW.provider_message_id, NEW.status, NEW.scheduled_for, NEW.sent_at,
    jsonb_build_object(
      'notification_type', NEW.notification_type,
      'action_url', NEW.action_url,
      'delivery_idempotency_key', NEW.delivery_idempotency_key,
      'delivery_attempt', v_attempt_no,
      'attempts', NEW.attempts,
      'last_error', NEW.last_error,
      'source', 'notification_jobs'
    ),
    coalesce(NEW.created_at, now()), v_attempt_no
  )
  ON CONFLICT (notification_job_id, attempt_no)
    WHERE notification_job_id IS NOT NULL
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
      WHEN EXCLUDED.status IN ('delivered','success','sent')
        THEN coalesce(public.notification_delivery_evidence.delivered_at, now())
      ELSE public.notification_delivery_evidence.delivered_at
    END,
    metadata = EXCLUDED.metadata;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.sync_notification_delivery_evidence()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sync_notification_delivery_evidence()
  TO service_role;

COMMIT;
