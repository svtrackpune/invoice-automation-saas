BEGIN;

-- The same token remains useful after a customer accepts a quotation: public
-- refreshes show the accepted/converted status and invoice number instead of
-- rendering the link as invalid. The token grants read-only quotation summary
-- access; invoice visibility continues to use the independent invoice token.
CREATE OR REPLACE FUNCTION public.get_public_quotation(
  p_public_accept_token text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  q public.quotations%rowtype;
  result jsonb;
BEGIN
  IF nullif(btrim(coalesce(p_public_accept_token, '')), '') IS NULL
     OR btrim(p_public_accept_token) !~ '^[A-Fa-f0-9]{48,128}$' THEN
    RAISE EXCEPTION 'Quotation not found';
  END IF;

  SELECT * INTO q
  FROM public.quotations
  WHERE public_accept_token = btrim(p_public_accept_token);

  IF q.id IS NULL THEN
    RAISE EXCEPTION 'Quotation not found';
  END IF;

  IF q.status NOT IN ('sent', 'accepted', 'converted') THEN
    RAISE EXCEPTION 'Quotation is not available';
  END IF;

  SELECT jsonb_build_object(
    'id', q.id,
    'quotation_number', q.quotation_number,
    'quotation_date', q.quotation_date,
    'valid_until', q.valid_until,
    'status', q.status,
    'invoice_id', q.invoice_id,
    'invoice_number', linked_invoice.invoice_number,
    'invoice_status', linked_invoice.status::text,
    'accepted_at', q.accepted_at,
    'accepted_via', q.accepted_via,
    'notes', q.notes,
    'terms', q.terms,
    'total', q.total,
    'subtotal', q.subtotal,
    'discount_total', q.discount_amount,
    'tax_total', q.tax_amount,
    'customer', jsonb_build_object(
      'id', c.id,
      'display_name', c.display_name,
      'legal_name', c.legal_name,
      'email', c.email,
      'phone', c.phone,
      'billing_address', c.billing_address,
      'shipping_address', c.shipping_address,
      'tax_id', c.tax_id
    ),
    'business', jsonb_build_object(
      'name', b.name,
      'legal_name', b.legal_name,
      'email', b.email,
      'phone', b.phone,
      'website', b.website,
      'address', b.address,
      'logo_url', b.logo_storage_path,
      'tax_registration_number',
        CASE WHEN coalesce(tp.gst_registration_type, 'NONE') = 'NONE'
          THEN NULL ELSE coalesce(tp.gstin, b.tax_registration_number) END
    ),
    'items', coalesce((
      SELECT jsonb_agg(
        jsonb_build_object(
          'description', qi.description,
          'quantity', qi.quantity,
          'unit_price', qi.unit_price,
          'discount_type', qi.discount_type,
          'discount_value', qi.discount_value,
          'tax_rate', coalesce(tr.rate, 0)
        ) ORDER BY qi.sort_order
      )
      FROM public.quotation_items qi
      LEFT JOIN public.tax_rates tr ON tr.id = qi.tax_rate_id
      WHERE qi.quotation_id = q.id
    ), '[]'::jsonb)
  ) INTO result
  FROM public.customers c
  JOIN public.businesses b ON b.id = q.business_id
  LEFT JOIN public.business_tax_profiles tp ON tp.business_id = q.business_id
  LEFT JOIN public.invoices linked_invoice
    ON linked_invoice.id = q.invoice_id
   AND linked_invoice.business_id = q.business_id
  WHERE c.id = q.customer_id AND c.business_id = q.business_id;

  RETURN result;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_public_quotation(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_quotation(text) TO anon, authenticated;

COMMIT;
