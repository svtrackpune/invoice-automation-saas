-- Rename the existing five system invoice/estimate templates to the customer-facing names used by Moneymatters.
-- The template keys remain unchanged so existing business_document_preferences continue to point to the same layouts.
UPDATE public.document_templates
SET template_name = CASE template_key
  WHEN 'classic' THEN 'Professional'
  WHEN 'bold' THEN 'Classic Business'
  WHEN 'modern' THEN 'Modern'
  WHEN 'minimal' THEN 'Minimal'
  WHEN 'compact' THEN 'Premium'
  ELSE template_name
END
WHERE is_system = true
  AND is_active = true
  AND document_type IN ('invoice', 'quotation');
