BEGIN;

ALTER TABLE public.businesses
  ADD COLUMN IF NOT EXISTS e_invoice_endpoint_id text,
  ADD COLUMN IF NOT EXISTS e_invoice_endpoint_scheme text;
ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS e_invoice_endpoint_id text,
  ADD COLUMN IF NOT EXISTS e_invoice_endpoint_scheme text;

ALTER TABLE public.businesses DROP CONSTRAINT IF EXISTS businesses_e_invoice_endpoint_scheme_chk;
ALTER TABLE public.businesses ADD CONSTRAINT businesses_e_invoice_endpoint_scheme_chk CHECK (
  e_invoice_endpoint_scheme IS NULL OR e_invoice_endpoint_scheme ~ '^[A-Z0-9]{2,16}$'
);
ALTER TABLE public.customers DROP CONSTRAINT IF EXISTS customers_e_invoice_endpoint_scheme_chk;
ALTER TABLE public.customers ADD CONSTRAINT customers_e_invoice_endpoint_scheme_chk CHECK (
  e_invoice_endpoint_scheme IS NULL OR e_invoice_endpoint_scheme ~ '^[A-Z0-9]{2,16}$'
);

ALTER TABLE public.businesses DROP CONSTRAINT IF EXISTS businesses_e_invoice_endpoint_pair_chk;
ALTER TABLE public.businesses ADD CONSTRAINT businesses_e_invoice_endpoint_pair_chk CHECK (
  (e_invoice_endpoint_id IS NULL AND e_invoice_endpoint_scheme IS NULL)
  OR (btrim(coalesce(e_invoice_endpoint_id,'')) <> '' AND btrim(coalesce(e_invoice_endpoint_scheme,'')) <> '')
);
ALTER TABLE public.customers DROP CONSTRAINT IF EXISTS customers_e_invoice_endpoint_pair_chk;
ALTER TABLE public.customers ADD CONSTRAINT customers_e_invoice_endpoint_pair_chk CHECK (
  (e_invoice_endpoint_id IS NULL AND e_invoice_endpoint_scheme IS NULL)
  OR (btrim(coalesce(e_invoice_endpoint_id,'')) <> '' AND btrim(coalesce(e_invoice_endpoint_scheme,'')) <> '')
);

COMMIT;