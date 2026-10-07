BEGIN;

-- The legacy renderer may remain callable only by signed-in application users.
-- Remove any explicit anonymous grant that predated the adapter migration.
REVOKE EXECUTE ON FUNCTION public.prepare_document_render(text,uuid,uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.prepare_document_render(text,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.prepare_document_render(text,uuid,uuid) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.prepare_document_render_legacy(text,uuid,uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.prepare_document_render_legacy(text,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.prepare_document_render_legacy(text,uuid,uuid) TO authenticated;

COMMIT;