BEGIN;

-- A notification reader may acknowledge an item, but must not rewrite its message,
-- tenant, payload, title, type, or timestamp.
REVOKE UPDATE ON TABLE public.notifications FROM authenticated;
GRANT UPDATE (is_read) ON TABLE public.notifications TO authenticated;

COMMIT;
