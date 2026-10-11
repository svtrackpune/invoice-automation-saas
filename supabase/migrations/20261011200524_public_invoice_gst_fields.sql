BEGIN;

-- Add the business-level UPI ID to the existing token-protected public invoice
-- response. Do not expose payment settings from arbitrary invoice IDs: this
-- function selects only the invoice addressed by its opaque public token.
CREATE OR REPLACE FUNCTION public.get_public_invoice(
  p_public_share_token text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  i public.invoices%rowtype;
  result jsonb;
BEGIN
  SELECT * INTO i
  FROM public.invoices
  WHERE public_share_token = p_public_share_token;

  IF i.id IS NULL THEN RAISE EXCEPTION 'Invoice not found'; END IF;
  IF i.status NOT IN ('sent','partially_paid','paid') THEN RAISE EXCEPTION 'Invoice is not available'; END IF;

  SELECT jsonb_build_object(
    'id', i.id,
    'invoice_number', i.invoice_number,
    'invoice_date', i.invoice_date,
    'due_date', i.due_date,
    'status', i.status::text,
    'currency_code', i.currency_code,
    'subtotal', i.subtotal,
    'discount_total', i.discount_total,
    'tax_total', i.tax_total,
    'cgst_amount', i.cgst_amount,
    'sgst_amount', i.sgst_amount,
    'igst_amount', i.igst_amount,
    'place_of_supply_state_code', i.place_of_supply_state_code,
    'supply_type', i.supply_type,
    'total', i.total,
    'amount_paid', i.amount_paid,
    'balance_due', i.balance_due,
    'notes', i.notes,
    'terms', i.terms,
    'payment_display_mode', i.payment_display_mode,
    'payment_link', CASE WHEN i.payment_display_mode='online' THEN i.payment_link ELSE null END,
    'payment_qr_payload', CASE WHEN i.payment_display_mode='online' THEN coalesce(i.payment_qr_payload,i.payment_link) ELSE null END,
    'upi_id', CASE
      WHEN i.payment_display_mode IN ('bank','online') AND coalesce(dps.payment_qr_enabled, true)
      THEN coalesce(nullif(btrim(dps.upi_id),''), nullif(btrim(ba.metadata->>'upi_id'),''))
      ELSE null
    END,
    'payment_qr_enabled', coalesce(dps.payment_qr_enabled, true),
    'template_id', i.template_id,
    'template_name', dt.template_name,
    'customer', jsonb_build_object(
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
      'phone', b.phone,
      'email', b.email,
      'website', b.website,
      'address', b.address,
      'logo_storage_path', b.logo_storage_path,
      'tax_registration_number', b.tax_registration_number
    ),
    'bank', CASE WHEN i.payment_display_mode='bank' AND ba.id IS NOT NULL THEN jsonb_build_object(
      'name', ba.name,
      'institution_name', ba.institution_name,
      'account_holder_name', ba.account_holder_name,
      'account_number', ba.account_number,
      'account_type', ba.account_type,
      'branch_name', ba.branch_name,
      'ifsc_code', ba.ifsc_code,
      'upi_id', coalesce(nullif(btrim(ba.metadata->>'upi_id'),''), nullif(btrim(dps.upi_id),''))
    ) ELSE null END,
    'items', coalesce((
      SELECT jsonb_agg(
        jsonb_build_object(
          'description', ii.description,
          'quantity', ii.quantity,
          'unit_price', ii.unit_price,
          'discount', ii.discount,
          'tax_amount', ii.tax_amount,
          'line_total', ii.line_total,
          'hsn_sac', ii.hsn_sac,
          'product_service_id', ii.product_service_id,
          'item_name', ps.name,
          'item_type', ps.item_type,
          'unit', ps.unit
        ) ORDER BY ii.sort_order
      )
      FROM public.invoice_items ii
      LEFT JOIN public.products_services ps ON ps.id=ii.product_service_id
      WHERE ii.invoice_id=i.id
    ), '[]'::jsonb)
  ) INTO result
  FROM public.customers c
  JOIN public.businesses b ON b.id=i.business_id
  LEFT JOIN public.document_templates dt ON dt.id=i.template_id
  LEFT JOIN public.document_payment_settings dps ON dps.business_id=i.business_id
  LEFT JOIN public.bank_accounts ba ON ba.id=i.payment_bank_account_id AND ba.business_id=i.business_id AND ba.is_active=true
  WHERE c.id=i.customer_id AND c.business_id=i.business_id;

  RETURN result;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_public_invoice(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_invoice(text) TO anon, authenticated;

COMMIT;
