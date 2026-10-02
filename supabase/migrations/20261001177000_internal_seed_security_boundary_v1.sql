BEGIN;
REVOKE ALL ON FUNCTION public.seed_business_defaults(uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.seed_business_feature_flags_after_update() FROM PUBLIC,anon,authenticated;
COMMIT;