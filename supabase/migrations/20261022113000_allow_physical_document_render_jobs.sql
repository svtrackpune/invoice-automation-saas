BEGIN;

-- Keep the financial document types already accepted by the production check and
-- add the two physical document types supported by prepare_document_render().
-- This is a narrow domain expansion; it does not change RLS, grants, or payload access.
ALTER TABLE public.document_render_jobs
  DROP CONSTRAINT IF EXISTS document_render_jobs_document_type_check;

ALTER TABLE public.document_render_jobs
  ADD CONSTRAINT document_render_jobs_document_type_check
  CHECK (
    document_type = ANY (
      ARRAY[
        'invoice'::text,
        'quotation'::text,
        'receipt'::text,
        'credit_note'::text,
        'debit_note'::text,
        'delivery_challan'::text,
        'purchase_order'::text
      ]
    )
  );

COMMIT;
