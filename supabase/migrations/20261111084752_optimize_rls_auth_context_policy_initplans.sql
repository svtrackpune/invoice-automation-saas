BEGIN;

-- Keep policy authorization semantics unchanged while evaluating auth.uid()
-- once per statement instead of repeatedly for every candidate row.
DO $rls_policy_preflight$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_policies
    WHERE schemaname='public' AND tablename='daily_cash_shifts'
      AND policyname='daily_cash_shifts_select' AND cmd='SELECT'
      AND roles @> ARRAY['authenticated'::name]
      AND position('reports.view' IN coalesce(qual,'')) > 0
      AND position('accounting.view' IN coalesce(qual,'')) > 0
      AND position('pos.cash_bill.create' IN coalesce(qual,'')) > 0
      AND position('auth.uid()' IN coalesce(qual,'')) > 0
  ) THEN
    RAISE EXCEPTION 'daily_cash_shifts_select policy drifted; refusing to alter it';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_policies
    WHERE schemaname='public' AND tablename='api_keys'
      AND policyname='api_keys_member_insert' AND cmd='INSERT'
      AND roles @> ARRAY['authenticated'::name]
      AND position('integrations.manage' IN coalesce(with_check,'')) > 0
      AND (
        coalesce(with_check,'') ~ 'created_by\s*=\s*auth\.uid\(\)'
        OR coalesce(with_check,'') ~ 'created_by\s*=\s*\(\s*SELECT\s+auth\.uid\(\)'
      )
  ) THEN
    RAISE EXCEPTION 'api_keys_member_insert policy drifted; refusing to alter it';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_policies
    WHERE schemaname='public' AND tablename='webhook_subscriptions'
      AND policyname='webhook_subscriptions_member_insert' AND cmd='INSERT'
      AND roles @> ARRAY['authenticated'::name]
      AND position('integrations.manage' IN coalesce(with_check,'')) > 0
      AND (
        coalesce(with_check,'') ~ 'created_by\s*=\s*auth\.uid\(\)'
        OR coalesce(with_check,'') ~ 'created_by\s*=\s*\(\s*SELECT\s+auth\.uid\(\)'
      )
  ) THEN
    RAISE EXCEPTION 'webhook_subscriptions_member_insert policy drifted; refusing to alter it';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_policies
    WHERE schemaname='public' AND tablename='business_communication_providers'
      AND policyname='business_communication_providers_manage' AND cmd='ALL'
      AND roles @> ARRAY['authenticated'::name]
      AND position('settings.manage' IN coalesce(qual,'')) > 0
      AND position('auth.uid()' IN coalesce(qual,'')) > 0
      AND position('settings.manage' IN coalesce(with_check,'')) > 0
      AND position('auth.uid()' IN coalesce(with_check,'')) > 0
  ) THEN
    RAISE EXCEPTION 'business_communication_providers_manage policy drifted; refusing to alter it';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_policies
    WHERE schemaname='public' AND tablename='communication_dispatch_logs'
      AND policyname='communication_dispatch_logs_select' AND cmd='SELECT'
      AND roles @> ARRAY['authenticated'::name]
      AND position('sales.view' IN coalesce(qual,'')) > 0
      AND position('auth.uid()' IN coalesce(qual,'')) > 0
  ) THEN
    RAISE EXCEPTION 'communication_dispatch_logs_select policy drifted; refusing to alter it';
  END IF;
END;
$rls_policy_preflight$;

ALTER POLICY daily_cash_shifts_select ON public.daily_cash_shifts
USING (
  mm_private.has_business_permission(business_id, 'reports.view'::text, (SELECT auth.uid()))
  OR mm_private.has_business_permission(business_id, 'accounting.view'::text, (SELECT auth.uid()))
  OR mm_private.has_business_permission(business_id, 'pos.cash_bill.create'::text, (SELECT auth.uid()))
);

ALTER POLICY api_keys_member_insert ON public.api_keys
WITH CHECK (
  mm_private.has_business_permission(business_id, 'integrations.manage'::text)
  AND created_by = (SELECT auth.uid())
);

ALTER POLICY webhook_subscriptions_member_insert ON public.webhook_subscriptions
WITH CHECK (
  mm_private.has_business_permission(business_id, 'integrations.manage'::text)
  AND created_by = (SELECT auth.uid())
);

ALTER POLICY business_communication_providers_manage ON public.business_communication_providers
USING (
  mm_private.has_business_permission(business_id, 'settings.manage'::text, (SELECT auth.uid()))
)
WITH CHECK (
  mm_private.has_business_permission(business_id, 'settings.manage'::text, (SELECT auth.uid()))
);

ALTER POLICY communication_dispatch_logs_select ON public.communication_dispatch_logs
USING (
  mm_private.has_business_permission(business_id, 'sales.view'::text, (SELECT auth.uid()))
);

COMMIT;
