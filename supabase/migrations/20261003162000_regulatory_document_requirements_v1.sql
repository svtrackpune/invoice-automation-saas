BEGIN;

ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS buyer_reference text;
ALTER TABLE public.invoices DROP CONSTRAINT IF EXISTS invoices_buyer_reference_chk;
ALTER TABLE public.invoices ADD CONSTRAINT invoices_buyer_reference_chk CHECK (
  buyer_reference IS NULL OR (btrim(buyer_reference)<>'' AND length(btrim(buyer_reference))<=70)
);

COMMIT;
