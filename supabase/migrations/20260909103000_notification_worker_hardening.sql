-- Notification worker hardening: atomically claim due jobs and expose only to service_role.
CREATE OR REPLACE FUNCTION public.claim_notification_jobs(p_limit integer DEFAULT 20)
RETURNS SETOF public.notification_jobs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=public,mm_private
AS $$
BEGIN
  RETURN QUERY
  WITH candidates AS (
    SELECT id FROM public.notification_jobs
    WHERE (
      (status='queued' AND scheduled_for<=now())
      OR (status='processing' AND updated_at < now()-interval '10 minutes')
    )
    AND attempts < 5
    ORDER BY scheduled_for, created_at
    FOR UPDATE SKIP LOCKED
    LIMIT greatest(least(coalesce(p_limit,20),100),1)
  )
  UPDATE public.notification_jobs j
  SET status='processing', attempts=attempts+1, updated_at=now(), last_error=NULL
  FROM candidates c
  WHERE j.id=c.id
  RETURNING j.*;
END;
$$;
REVOKE ALL ON FUNCTION public.claim_notification_jobs(integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_notification_jobs(integer) TO service_role;
