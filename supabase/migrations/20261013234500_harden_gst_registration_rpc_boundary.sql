BEGIN;

-- GST collection must be gated by a usable registration, not legacy feature flags.
CREATE OR REPLACE FUNCTION mm_private.has_valid_gst_registration(p_business_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'mm_private', 'pg_temp'
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.business_tax_profiles tp
    JOIN public.businesses b ON b.id = tp.business_id
    WHERE tp.business_id = p_business_id
      AND upper(coalesce(tp.tax_regime, 'NONE')) = 'GST'
      AND upper(coalesce(tp.gst_registration_type, 'NONE'))
          IN ('REGULAR', 'CASUAL', 'NON_RESIDENT', 'SEZ')
      AND CASE
        WHEN upper(coalesce(b.country_code, 'IN')) = 'IN'
          THEN upper(btrim(coalesce(tp.gstin, '')))
               ~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z]Z[0-9A-Z]$'
        ELSE nullif(btrim(coalesce(tp.gstin, '')), '') IS NOT NULL
      END
  );
$function$;

-- Preserve configured non-Indian VAT/sales-tax modes. For Indian businesses,
-- the valid GST registration profile is the sole authority for tax enablement.
CREATE OR REPLACE FUNCTION mm_private.business_tax_enabled(p_business_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'mm_private', 'pg_temp'
AS $function$
  SELECT coalesce((
    SELECT CASE
      WHEN upper(coalesce(b.country_code, 'IN')) = 'IN'
        THEN mm_private.has_valid_gst_registration(p_business_id)
      WHEN upper(coalesce(tp.tax_regime, 'NONE')) = 'GST'
        THEN mm_private.has_valid_gst_registration(p_business_id)
      WHEN upper(coalesce(tp.tax_regime, 'NONE')) IN ('VAT', 'SALES_TAX', 'OTHER')
        THEN lower(coalesce(b.tax_settings->>'enabled', 'false')) = 'true'
      ELSE false
    END
    FROM public.business_tax_profiles tp
    JOIN public.businesses b ON b.id = tp.business_id
    WHERE tp.business_id = p_business_id
  ), false);
$function$;

REVOKE ALL ON FUNCTION mm_private.has_valid_gst_registration(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION mm_private.business_tax_enabled(uuid) FROM PUBLIC, anon, authenticated;

-- Safe in-migration patch helper: fail the transaction rather than silently
-- leaving a target RPC on the old tax-registration logic.
CREATE FUNCTION pg_temp.patch_function_definition(
  p_signature regprocedure,
  p_old text,
  p_new text
) RETURNS void
LANGUAGE plpgsql
SET search_path TO 'pg_catalog', 'public', 'mm_private', 'pg_temp'
AS $patch$
DECLARE
  v_definition text := pg_get_functiondef(p_signature);
BEGIN
  IF position(p_new IN v_definition) > 0 THEN
    RETURN;
  END IF;
  IF position(p_old IN v_definition) = 0 THEN
    RAISE EXCEPTION 'Expected tax-boundary anchor not found in %', p_signature;
  END IF;
  v_definition := replace(v_definition, p_old, p_new);
  EXECUTE v_definition;
END;
$patch$;

-- Standard invoice creation: use the profile helper, and ask for HSN/SAC only
-- when the business has a valid GST registration.
SELECT pg_temp.patch_function_definition(
  'public.create_invoice_from_items(uuid,uuid,date,date,jsonb,text,numeric,text,text)'::regprocedure,
  $old$coalesce((b.feature_flags->>'is_tax_registered')::boolean,false)$old$,
  $new$mm_private.business_tax_enabled(p_business_id)$new$
);
SELECT pg_temp.patch_function_definition(
  'public.create_invoice_from_items(uuid,uuid,date,date,jsonb,text,numeric,text,text)'::regprocedure,
  $old$if v_tax_enabled then
      if v_product is null then raise exception 'HSN / SAC is required for every tax-registered invoice line';$old$,
  $new$if mm_private.has_valid_gst_registration(p_business_id) then
      if v_product is null then raise exception 'HSN / SAC is required for every tax-registered invoice line';$new$
);

-- Draft invoice correction.
SELECT pg_temp.patch_function_definition(
  'public.update_invoice_draft(uuid,uuid,date,date,jsonb,text,numeric,text,text,uuid)'::regprocedure,
  $old$coalesce((b.feature_flags->>'is_tax_registered')::boolean,false)$old$,
  $new$mm_private.business_tax_enabled(inv.business_id)$new$
);
SELECT pg_temp.patch_function_definition(
  'public.update_invoice_draft(uuid,uuid,date,date,jsonb,text,numeric,text,text,uuid)'::regprocedure,
  $old$if v_tax_enabled then
      if v_product is null then raise exception 'HSN / SAC is required for every tax-registered invoice line';$old$,
  $new$if mm_private.has_valid_gst_registration(inv.business_id) then
      if v_product is null then raise exception 'HSN / SAC is required for every tax-registered invoice line';$new$
);

-- Financial correction of an existing invoice.
SELECT pg_temp.patch_function_definition(
  'public.update_invoice_any_state(uuid,uuid,date,date,jsonb,text,numeric,text,text,uuid,date,uuid,text,uuid)'::regprocedure,
  $old$coalesce((b.feature_flags->>'is_tax_registered')::boolean,false)$old$,
  $new$mm_private.business_tax_enabled(inv.business_id)$new$
);
SELECT pg_temp.patch_function_definition(
  'public.update_invoice_any_state(uuid,uuid,date,date,jsonb,text,numeric,text,text,uuid,date,uuid,text,uuid)'::regprocedure,
  $old$IF v_tax_enabled THEN
      IF v_product IS NULL THEN RAISE EXCEPTION 'HSN / SAC is required for every tax-registered invoice line';$old$,
  $new$IF mm_private.has_valid_gst_registration(inv.business_id) THEN
      IF v_product IS NULL THEN RAISE EXCEPTION 'HSN / SAC is required for every tax-registered invoice line';$new$
);

-- A delivery challan converted to an invoice is subject to the same boundary.
SELECT pg_temp.patch_function_definition(
  'public.convert_delivery_challan_to_invoice(uuid,uuid,text)'::regprocedure,
  $old$v_tax_enabled := coalesce((v_business.feature_flags->>'is_tax_registered')::boolean,false);$old$,
  $new$v_tax_enabled := mm_private.business_tax_enabled(p_business_id);$new$
);
SELECT pg_temp.patch_function_definition(
  'public.convert_delivery_challan_to_invoice(uuid,uuid,text)'::regprocedure,
  $old$IF v_tax_enabled
       AND v_item.product_service_id IS NOT NULL
       AND nullif(trim(coalesce(v_item.hsn_sac,v_item.product_hsn_sac,'')),'') IS NULL$old$,
  $new$IF mm_private.has_valid_gst_registration(p_business_id)
       AND v_item.product_service_id IS NOT NULL
       AND nullif(trim(coalesce(v_item.hsn_sac,v_item.product_hsn_sac,'')),'') IS NULL$new$
);

-- Quotations calculate GST only when the profile is actually registered.
SELECT pg_temp.patch_function_definition(
  'public.create_quotation_from_items(uuid,uuid,date,date,jsonb,text,text,uuid)'::regprocedure,
  $old$(tax_settings->>'enabled')::boolean$old$,
  $new$mm_private.business_tax_enabled(p_business_id)$new$
);

-- The update RPC previously calculated a tax rate directly without consulting
-- the seller's tax profile. Retain non-Indian configured tax modes while
-- clearing rates/tax amounts for an unregistered Indian seller.
SELECT pg_temp.patch_function_definition(
  'public.update_quotation_from_items(uuid,uuid,date,date,jsonb,text,text,uuid)'::regprocedure,
  $old$v_index integer := 0;$old$,
  $new$v_index integer := 0;
  v_tax_enabled boolean := false;$new$
);
SELECT pg_temp.patch_function_definition(
  'public.update_quotation_from_items(uuid,uuid,date,date,jsonb,text,text,uuid)'::regprocedure,
  $old$IF q.id IS NULL THEN RAISE EXCEPTION 'Quotation not found'; END IF;$old$,
  $new$IF q.id IS NULL THEN RAISE EXCEPTION 'Quotation not found'; END IF;
  v_tax_enabled := mm_private.business_tax_enabled(q.business_id);$new$
);
SELECT pg_temp.patch_function_definition(
  'public.update_quotation_from_items(uuid,uuid,date,date,jsonb,text,text,uuid)'::regprocedure,
  $old$SELECT coalesce(tr.rate,0) INTO v_rate FROM public.tax_rates tr WHERE tr.id=NULLIF(item->>'tax_rate_id','')::uuid AND tr.business_id=q.business_id AND tr.is_active;
    v_rate := coalesce(v_rate,0);$old$,
  $new$IF v_tax_enabled THEN
      SELECT coalesce(tr.rate,0) INTO v_rate FROM public.tax_rates tr WHERE tr.id=NULLIF(item->>'tax_rate_id','')::uuid AND tr.business_id=q.business_id AND tr.is_active;
    ELSE
      v_rate := 0;
    END IF;
    v_rate := coalesce(v_rate,0);$new$
);
SELECT pg_temp.patch_function_definition(
  'public.update_quotation_from_items(uuid,uuid,date,date,jsonb,text,text,uuid)'::regprocedure,
  $old$greatest(0,coalesce((item->>'discount_value')::numeric,0)),NULLIF(item->>'tax_rate_id','')::uuid,v_base,v_disc,v_line_tax,v_line_total,v_index);$old$,
  $new$greatest(0,coalesce((item->>'discount_value')::numeric,0)),CASE WHEN v_tax_enabled THEN NULLIF(item->>'tax_rate_id','')::uuid ELSE NULL END,v_base,v_disc,v_line_tax,v_line_total,v_index);$new$
);

-- The dynamic tax provider is server-side, but the SECURITY DEFINER RPC remains
-- a boundary. An Indian business without a valid GST registration may not pass
-- non-zero dynamic tax amounts or snapshots for GST rules into that RPC.
SELECT pg_temp.patch_function_definition(
  'public.create_invoice_with_dynamic_tax(uuid,uuid,date,date,jsonb,text,text,text,boolean)'::regprocedure,
  $old$v_meta:=coalesce(v_item->'dynamic_tax_snapshot','[]'::jsonb);$old$,
  $new$v_meta:=coalesce(v_item->'dynamic_tax_snapshot','[]'::jsonb);
    IF upper(coalesce((SELECT country_code FROM public.businesses WHERE id=p_business_id), 'IN')) = 'IN'
       AND NOT mm_private.has_valid_gst_registration(p_business_id)
       AND (
         v_tax > 0
         OR EXISTS (
           SELECT 1 FROM jsonb_array_elements(v_meta) AS snapshot(value)
           JOIN public.tax_rules tr ON tr.id = nullif(snapshot.value->>'taxRuleId','')::uuid
           WHERE upper(coalesce(tr.tax_system,'')) = 'GST'
         )
         OR EXISTS (
           SELECT 1 FROM public.tax_rules tr
           WHERE tr.id = nullif(v_item->>'tax_rule_id','')::uuid
             AND upper(coalesce(tr.tax_system,'')) = 'GST'
         )
       )
    THEN
      RAISE EXCEPTION 'GST cannot be charged for an Indian business without a valid registered GSTIN. Configure the GST registration or issue a non-GST invoice.';
    END IF;$new$
);
SELECT pg_temp.patch_function_definition(
  'public.create_invoice_with_dynamic_tax(uuid,uuid,uuid,date,date,jsonb,text,text,text,boolean)'::regprocedure,
  $old$v_meta:=coalesce(v_item->'dynamic_tax_snapshot','[]'::jsonb);$old$,
  $new$v_meta:=coalesce(v_item->'dynamic_tax_snapshot','[]'::jsonb);
    IF upper(coalesce((SELECT country_code FROM public.businesses WHERE id=p_business_id), 'IN')) = 'IN'
       AND NOT mm_private.has_valid_gst_registration(p_business_id)
       AND (
         v_tax > 0
         OR EXISTS (
           SELECT 1 FROM jsonb_array_elements(v_meta) AS snapshot(value)
           JOIN public.tax_rules tr ON tr.id = nullif(snapshot.value->>'taxRuleId','')::uuid
           WHERE upper(coalesce(tr.tax_system,'')) = 'GST'
         )
         OR EXISTS (
           SELECT 1 FROM public.tax_rules tr
           WHERE tr.id = nullif(v_item->>'tax_rule_id','')::uuid
             AND upper(coalesce(tr.tax_system,'')) = 'GST'
         )
       )
    THEN
      RAISE EXCEPTION 'GST cannot be charged for an Indian business without a valid registered GSTIN. Configure the GST registration or issue a non-GST invoice.';
    END IF;$new$
);
SELECT pg_temp.patch_function_definition(
  'public.api_create_invoice_with_dynamic_tax(text,uuid,uuid,date,date,jsonb,text,text,text,boolean)'::regprocedure,
  $old$v_meta:=coalesce(v_item->'dynamic_tax_snapshot','[]'::jsonb);$old$,
  $new$v_meta:=coalesce(v_item->'dynamic_tax_snapshot','[]'::jsonb);
    IF upper(coalesce((SELECT country_code FROM public.businesses WHERE id=p_business_id), 'IN')) = 'IN'
       AND NOT mm_private.has_valid_gst_registration(p_business_id)
       AND (
         v_tax > 0
         OR EXISTS (
           SELECT 1 FROM jsonb_array_elements(v_meta) AS snapshot(value)
           JOIN public.tax_rules tr ON tr.id = nullif(snapshot.value->>'taxRuleId','')::uuid
           WHERE upper(coalesce(tr.tax_system,'')) = 'GST'
         )
         OR EXISTS (
           SELECT 1 FROM public.tax_rules tr
           WHERE tr.id = nullif(v_item->>'tax_rule_id','')::uuid
             AND upper(coalesce(tr.tax_system,'')) = 'GST'
         )
       )
    THEN
      RAISE EXCEPTION 'GST cannot be charged for an Indian business without a valid registered GSTIN. Configure the GST registration or issue a non-GST invoice.';
    END IF;$new$
);

DROP FUNCTION pg_temp.patch_function_definition(regprocedure,text,text);

COMMIT;
