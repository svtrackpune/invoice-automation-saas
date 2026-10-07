BEGIN;

ALTER TABLE public.document_templates
  DROP CONSTRAINT IF EXISTS document_templates_document_type_check;

ALTER TABLE public.document_templates
  ADD CONSTRAINT document_templates_document_type_check
  CHECK (document_type = ANY (ARRAY[
    'quotation'::text,
    'invoice'::text,
    'receipt'::text,
    'delivery_challan'::text,
    'purchase_order'::text,
    'credit_note'::text,
    'cash_bill'::text
  ]));

-- The existing template table is the canonical visual layout catalog.
-- Add the three supported document types that did not yet have system presets.
INSERT INTO public.document_templates
  (document_type, template_key, template_name, description, version, layout_config, supported_features, is_system, is_active)
SELECT v.document_type, v.template_key, v.template_name, v.description, 1,
       '{"responsive":true,"wysiwyg":true}'::jsonb,
       '{"theme":true,"logo":true,"qr":true,"balance_footer":true,"row_padding":true}'::jsonb,
       true, true
FROM (VALUES
  ('purchase_order','classic','Classic Purchase Order','Clean purchasing document with traditional accounting layout.'),
  ('purchase_order','minimal','Minimal Purchase Order','Reduced-ink purchase order for compact printing.'),
  ('purchase_order','modern','Modern Purchase Order','Modern purchasing layout with a prominent accent system.'),
  ('purchase_order','premium','Premium Purchase Order','Premium purchase order layout with stronger document hierarchy.'),
  ('purchase_order','professional','Professional Purchase Order','Formal purchase order layout for business-to-business use.'),
  ('credit_note','classic','Classic Credit Note','Traditional credit note layout aligned with invoice presentation.'),
  ('credit_note','minimal','Minimal Credit Note','Reduced-ink credit note for compact printing.'),
  ('credit_note','modern','Modern Credit Note','Modern credit note layout with a prominent accent system.'),
  ('credit_note','premium','Premium Credit Note','Premium credit note layout with stronger document hierarchy.'),
  ('credit_note','professional','Professional Credit Note','Formal credit note layout for business use.'),
  ('cash_bill','classic','Classic Cash Bill','Counter-sales receipt layout with traditional document hierarchy.'),
  ('cash_bill','minimal','Minimal Cash Bill','Compact cash-bill layout optimized for fast printing.'),
  ('cash_bill','modern','Modern Cash Bill','Modern counter-sales layout with clear payment emphasis.'),
  ('cash_bill','premium','Premium Cash Bill','Premium counter-sales document layout.'),
  ('cash_bill','professional','Professional Cash Bill','Formal cash-bill layout for customer handover.')
) AS v(document_type,template_key,template_name,description)
WHERE NOT EXISTS (
  SELECT 1
  FROM public.document_templates dt
  WHERE dt.document_type = v.document_type
    AND dt.template_key = v.template_key
);

COMMIT;