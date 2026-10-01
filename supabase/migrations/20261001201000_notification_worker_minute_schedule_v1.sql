BEGIN;

CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

SELECT cron.unschedule('moneymatters-notification-worker')
WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'moneymatters-notification-worker'
);

SELECT cron.schedule(
  'moneymatters-notification-worker',
  '* * * * *',
  $job$
    SELECT net.http_post(
      url := 'https://qpczmbvqflaqwvyphepf.supabase.co/functions/v1/process-notifications',
      body := jsonb_build_object(
        'source', 'pg_cron_notification_worker',
        'triggered_at', now()
      ),
      headers := jsonb_build_object('Content-Type', 'application/json'),
      timeout_milliseconds := 10000
    );
  $job$
);

COMMIT;
