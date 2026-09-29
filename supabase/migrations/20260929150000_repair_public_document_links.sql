-- Repair the public quotation reader against the live quotations schema.
-- Add customer-facing invoice share tokens and public readers.

CREATE OR REPLACE FUNCTION public.get_public_quotation(p_public_accept_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  q public.quotations%rowtype;
  result jsonb;
BEGIN
  SELECT * INTO q
  FROM public.quotations
  WHERE public_accept_token = p_public_accept_token;

  IF q.id IS NULL THEN RAISE EXCEPTION 'Quotation not found'; END IF;
  IF q.status NOT IN ('sent','accepted') THEN RAISE EXCEPTION 'Quotation is not available'; END IF;
  IF q.valid_until IS NOT NULL AND q.valid_until < current_date AND q.status <> 'accepted' THEN
    RAISE EXCEPTION 'Quotation has expired';
  END IF;

  SELECT jsonb_build_object(
    'id', q.id,
    'quotation_number', q.quotation_number,
    'quotation_date', q.quotation_date,
    'valid_until', q.valid_until,
    'status', q.status,
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
      'billing_address', c.billing_address
    ),
    'business', jsonb_build_object(
      'name', b.name,
      'legal_name', b.legal_name,
      'email', b.email,
      'phone', b.phone,
      'website', b.website,
      'address', b.address,
      'logo_url', b.logo_storage_path,
      'tax_registration_number', CASE WHEN coalesce(tp.gst_registration_type,'NONE')='NONE' THEN null ELSE coalesce(tp.gstin,b.tax_registration_number) END
    ),
    'items', coalesce((
      SELECT jsonb_agg(
        jsonb_build_object(
          'description', qi.description,
          'quantity', qi.quantity,
          'unit_price', qi.unit_price,
          'discount_type', qi.discount_type,
          'discount_value', qi.discount_value,
          'tax_rate', coalesce(tr.rate,0)
        ) ORDER BY qi.sort_order
      )
      FROM public.quotation_items qi
      LEFT JOIN public.tax_rates tr ON tr.id=qi.tax_rate_id
      WHERE qi.quotation_id=q.id
    ), '[]'::jsonb)
  ) INTO result
  FROM public.customers c
  JOIN public.businesses b ON b.id=q.business_id
  LEFT JOIN public.business_tax_profiles tp ON tp.business_id=q.business_id
  WHERE c.id=q.customer_id AND c.business_id=q.business_id;

  RETURN result;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_public_quotation(text) FROM public, authenticated;
GRANT EXECUTE ON FUNCTION public.get_public_quotation(text) TO anon;

ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS public_share_token text
    DEFAULT encode(gen_random_bytes(24), 'hex');

CREATE UNIQUE INDEX IF NOT EXISTS invoices_public_share_token_uidx
  ON public.invoices(public_share_token)
  WHERE public_share_token IS NOT NULL;

UPDATE public.invoices
SET public_share_token = encode(gen_random_bytes(24), 'hex')
WHERE public_share_token IS NULL;

CREATE OR REPLACE FUNCTION public.get_public_invoice(p_public_share_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
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
    'total', i.total,
    'amount_paid', i.amount_paid,
    'balance_due', i.balance_due,
    'notes', i.notes,
    'terms', i.terms,
    'payment_display_mode', i.payment_display_mode,
    'payment_link', CASE WHEN i.payment_display_mode='online' THEN i.payment_link ELSE null END,
    'payment_qr_payload', CASE WHEN i.payment_display_mode='online' THEN coalesce(i.payment_qr_payload,i.payment_link) ELSE null END,
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
      'upi_id', ba.metadata->>'upi_id'
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
  LEFT JOIN public.bank_accounts ba ON ba.id=i.payment_bank_account_id AND ba.business_id=i.business_id AND ba.is_active=true
  WHERE c.id=i.customer_id AND c.business_id=i.business_id;

  RETURN result;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_public_invoice(text) FROM public, authenticated;
GRANT EXECUTE ON FUNCTION public.get_public_invoice(text) TO anon;

CREATE OR REPLACE FUNCTION public.get_public_invoice_share_token(p_invoice_id uuid)
RETURNS text
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
STABLE
AS $$
  SELECT i.public_share_token
  FROM public.invoices i
  WHERE i.id = p_invoice_id
    AND i.status IN ('sent','partially_paid','paid');
$$;

REVOKE EXECUTE ON FUNCTION public.get_public_invoice_share_token(uuid) FROM public, authenticated;
GRANT EXECUTE ON FUNCTION public.get_public_invoice_share_token(uuid) TO anon;
