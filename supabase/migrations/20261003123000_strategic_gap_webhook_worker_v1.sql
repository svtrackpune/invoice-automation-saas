BEGIN;

CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

SELECT cron.unschedule('moneymatters-webhook-worker')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname='moneymatters-webhook-worker');

SELECT cron.schedule(
  'moneymatters-webhook-worker',
  '* * * * *',
  $job$
    SELECT net.http_post(
      url := 'https://qpczmbvqflaqwvyphepf.supabase.co/functions/v1/process-webhooks',
      body := jsonb_build_object(
        'source','pg_cron_webhook_worker',
        'triggered_at',now()
      ),
      headers := jsonb_build_object('Content-Type','application/json'),
      timeout_milliseconds := 10000
    );
  $job$
);

COMMIT;