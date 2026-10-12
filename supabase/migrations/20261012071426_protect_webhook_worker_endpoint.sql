BEGIN;

-- The webhook delivery worker is called by pg_cron every minute. Keep the
-- custom edge authorization in sync with the notification worker's Vault token.
DO $job$
DECLARE
  v_job_id bigint;
BEGIN
  SELECT jobid INTO v_job_id
  FROM cron.job
  WHERE jobname = 'moneymatters-webhook-worker'
  LIMIT 1;

  IF v_job_id IS NULL THEN
    RAISE EXCEPTION 'moneymatters-webhook-worker cron job was not found';
  END IF;

  PERFORM cron.alter_job(
    v_job_id,
    command := $command$
      SELECT net.http_post(
        url := 'https://qpczmbvqflaqwvyphepf.supabase.co/functions/v1/process-webhooks',
        body := jsonb_build_object('source','pg_cron_webhook_worker','triggered_at',now()),
        headers := jsonb_build_object(
          'Content-Type','application/json',
          'x-moneymatters-worker-token',
          (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='notification_worker_token' LIMIT 1)
        ),
        timeout_milliseconds := 10000
      );
    $command$
  );
END
$job$;

COMMIT;
