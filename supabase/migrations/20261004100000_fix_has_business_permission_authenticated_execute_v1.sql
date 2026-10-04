BEGIN;

-- The permission helper is a SECURITY DEFINER function used by authenticated RLS policies.
-- Restore authenticated execution while keeping anonymous/public execution denied.
REVOKE EXECUTE ON FUNCTION mm_private.has_business_permission(uuid,text,uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION mm_private.has_business_permission(uuid,text,uuid) TO authenticated;

COMMIT;
