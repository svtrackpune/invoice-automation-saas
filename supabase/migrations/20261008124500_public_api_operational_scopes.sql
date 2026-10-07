BEGIN;
ALTER TABLE public.api_keys DROP CONSTRAINT IF EXISTS api_keys_scopes_chk;
ALTER TABLE public.api_keys ADD CONSTRAINT api_keys_scopes_chk CHECK (scopes <@ ARRAY['invoices:read','invoices:write','customers:read','customers:write','inventory:read','inventory:write','reports:read']::text[]);
COMMIT;