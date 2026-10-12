BEGIN;

-- The scheduled worker endpoint must not be publicly invokable. Keep Supabase
-- JWT verification unchanged for compatibility, but require a Vault-backed
-- service token for pg_cron; authenticated users may only invoke their own
-- permission-checked manual-test job.
DO $vault$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM vault.decrypted_secrets
    WHERE name = 'notification_worker_token'
  ) THEN
    PERFORM vault.create_secret(
      encode(extensions.gen_random_bytes(32), 'hex'),
      'notification_worker_token',
      'Service-to-service token for the Moneymatters notification worker'
    );
  END IF;
END
$vault$;

CREATE OR REPLACE FUNCTION public.is_notification_worker_token_valid(
  p_token text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault, pg_temp
AS $function$
DECLARE
  v_expected text;
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' THEN
    RETURN false;
  END IF;

  SELECT decrypted_secret INTO v_expected
  FROM vault.decrypted_secrets
  WHERE name = 'notification_worker_token'
  LIMIT 1;

  RETURN v_expected IS NOT NULL
    AND p_token IS NOT NULL
    AND length(p_token) >= 48
    AND p_token = v_expected;
END;
$function$;

REVOKE ALL ON FUNCTION public.is_notification_worker_token_valid(text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.is_notification_worker_token_valid(text)
  TO service_role;

CREATE OR REPLACE FUNCTION public.authorize_notification_test_dispatch(
  p_job_id uuid,
  p_user_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, mm_private, pg_temp
AS $function$
  SELECT coalesce(auth.role(), '') = 'service_role'
    AND EXISTS (
      SELECT 1
      FROM public.notification_jobs j
      WHERE j.id = p_job_id
        AND j.notification_type = 'manual_test'
        AND j.metadata->>'test' = 'true'
        AND mm_private.has_business_permission(
          j.business_id,
          'settings.manage',
          p_user_id
        )
    );
$function$;

REVOKE ALL ON FUNCTION public.authorize_notification_test_dispatch(uuid,uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.authorize_notification_test_dispatch(uuid,uuid)
  TO service_role;

DO $jobs$
DECLARE
  v_job record;
  v_updated integer := 0;
BEGIN
  FOR v_job IN
    SELECT jobid, jobname
    FROM cron.job
    WHERE jobname IN (
      'moneymatters-billing-automation',
      'moneymatters-notification-worker'
    )
  LOOP
    IF v_job.jobname = 'moneymatters-billing-automation' THEN
      PERFORM cron.alter_job(
        v_job.jobid,
        command := $command$
          SELECT public.process_due_recurring_invoices(now());
          SELECT public.enqueue_all_invoice_reminders(now());
          SELECT net.http_post(
            url := 'https://qpczmbvqflaqwvyphepf.supabase.co/functions/v1/process-notifications',
            body := jsonb_build_object('source','pg_cron','triggered_at',now()),
            headers := jsonb_build_object(
              'Content-Type','application/json',
              'x-moneymatters-worker-token',
              (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='notification_worker_token' LIMIT 1)
            ),
            timeout_milliseconds := 10000
          );
        $command$
      );
    ELSE
      PERFORM cron.alter_job(
        v_job.jobid,
        command := $command$
          SELECT net.http_post(
            url := 'https://qpczmbvqflaqwvyphepf.supabase.co/functions/v1/process-notifications',
            body := jsonb_build_object('source','pg_cron','triggered_at',now()),
            headers := jsonb_build_object(
              'Content-Type','application/json',
              'x-moneymatters-worker-token',
              (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='notification_worker_token' LIMIT 1)
            ),
            timeout_milliseconds := 10000
          );
        $command$
      );
    END IF;
    v_updated := v_updated + 1;
  END LOOP;

  IF v_updated <> 2 THEN
    RAISE EXCEPTION 'Expected to update both notification scheduler jobs; updated %', v_updated;
  END IF;
END
$jobs$;

COMMIT;
