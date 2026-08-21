-- Product/service master-data extensions.
ALTER TABLE public.products_services
  ADD COLUMN IF NOT EXISTS guarantee_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS guarantee_months integer,
  ADD COLUMN IF NOT EXISTS guarantee_description text,
  ADD COLUMN IF NOT EXISTS warranty_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS warranty_months integer,
  ADD COLUMN IF NOT EXISTS warranty_description text;

ALTER TABLE public.products_services
  DROP CONSTRAINT IF EXISTS products_services_guarantee_months_check,
  DROP CONSTRAINT IF EXISTS products_services_warranty_months_check,
  DROP CONSTRAINT IF EXISTS products_services_guarantee_description_check,
  DROP CONSTRAINT IF EXISTS products_services_warranty_description_check;

ALTER TABLE public.products_services
  ADD CONSTRAINT products_services_guarantee_months_check CHECK (guarantee_months IS NULL OR guarantee_months BETWEEN 1 AND 1200),
  ADD CONSTRAINT products_services_warranty_months_check CHECK (warranty_months IS NULL OR warranty_months BETWEEN 1 AND 1200),
  ADD CONSTRAINT products_services_guarantee_description_check CHECK (guarantee_description IS NULL OR char_length(guarantee_description) <= 100),
  ADD CONSTRAINT products_services_warranty_description_check CHECK (warranty_description IS NULL OR char_length(warranty_description) <= 100);

CREATE INDEX IF NOT EXISTS products_services_business_type_name_idx ON public.products_services (business_id, item_type, name);
CREATE INDEX IF NOT EXISTS invoices_business_status_due_date_idx ON public.invoices (business_id, status, due_date);
CREATE INDEX IF NOT EXISTS invoices_business_date_idx ON public.invoices (business_id, invoice_date);
CREATE INDEX IF NOT EXISTS invoices_business_number_idx ON public.invoices (business_id, invoice_number);
