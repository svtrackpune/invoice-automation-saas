BEGIN;

-- Production schema has no style_name/is_default columns. Canonical style is
-- represented by template_key (e.g. quotation_modern -> modern).
UPDATE public.business_document_preferences bdp
SET template_id = active_t.id,
    updated_at = NOW()
FROM public.document_templates inactive_t
JOIN public.document_templates active_t
  ON active_t.document_type = inactive_t.document_type
 AND active_t.is_active = TRUE
 AND (
   active_t.template_key = inactive_t.template_key
   OR active_t.template_key = regexp_replace(inactive_t.template_key, '^' || inactive_t.document_type || '_', '')
 )
WHERE bdp.template_id = inactive_t.id
  AND inactive_t.is_active = FALSE;

-- Fallback: use the canonical active 'modern' template where available;
-- otherwise use the first active system template for the same document type.
UPDATE public.business_document_preferences bdp
SET template_id = fallback_t.id,
    updated_at = NOW()
FROM public.document_templates inactive_t
JOIN LATERAL (
  SELECT t.id
  FROM public.document_templates t
  WHERE t.document_type = inactive_t.document_type
    AND t.is_active = TRUE
    AND t.is_system = TRUE
  ORDER BY (t.template_key = 'modern') DESC, t.template_key
  LIMIT 1
) fallback_t ON TRUE
WHERE bdp.template_id = inactive_t.id
  AND inactive_t.is_active = FALSE;

COMMIT;