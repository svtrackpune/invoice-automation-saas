-- Product/service guarantee and warranty fields used by the catalog UI.
ALTER TABLE public.products_services
  ADD COLUMN IF NOT EXISTS guarantee_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS guarantee_months integer,
  ADD COLUMN IF NOT EXISTS guarantee_description text,
  ADD COLUMN IF NOT EXISTS warranty_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS warranty_months integer,
  ADD COLUMN IF NOT EXISTS warranty_description text;

ALTER TABLE public.products_services
  DROP CONSTRAINT IF EXISTS products_services_guarantee_months_check;

ALTER TABLE public.products_services
  ADD CONSTRAINT products_services_guarantee_months_check
  CHECK (guarantee_months IS NULL OR guarantee_months BETWEEN 1 AND 1200);

ALTER TABLE public.products_services
  DROP CONSTRAINT IF EXISTS products_services_warranty_months_check;

ALTER TABLE public.products_services
  ADD CONSTRAINT products_services_warranty_months_check
  CHECK (warranty_months IS NULL OR warranty_months BETWEEN 1 AND 1200);
