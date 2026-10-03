BEGIN;

CREATE OR REPLACE FUNCTION public.get_cash_bill_pos_context(p_business_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,mm_private AS $fn$
DECLARE v_products jsonb; v_taxes jsonb; v_cash jsonb; v_upi jsonb; v_profile jsonb; v_upi_label jsonb; v_offline_enabled boolean:=false; v_bank_account uuid;
BEGIN
  IF NOT mm_private.has_business_permission(p_business_id,'pos.cash_bill.create') THEN RAISE EXCEPTION 'Access denied'; END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object('id',p.id,'name',p.name,'sku',p.sku,'sales_price',p.sales_price,'default_tax_rate_id',p.default_tax_rate_id) ORDER BY p.name),'[]'::jsonb) INTO v_products FROM public.products_services p WHERE p.business_id=p_business_id AND p.is_active AND p.sell_enabled;
  SELECT coalesce(jsonb_agg(jsonb_build_object('id',t.id,'name',t.name,'rate',t.rate) ORDER BY t.rate),'[]'::jsonb) INTO v_taxes FROM public.tax_rates t WHERE t.business_id=p_business_id AND t.is_active;
  SELECT coalesce(jsonb_build_object('id',a.id,'code',a.code,'name',a.name,'account_subtype',a.account_subtype),'{}'::jsonb) INTO v_cash FROM public.accounts a WHERE a.business_id=p_business_id AND a.is_active AND a.account_subtype='cash' ORDER BY a.code LIMIT 1;
  SELECT bpm.bank_account_id INTO v_bank_account FROM public.business_payment_method_accounts bpm WHERE bpm.business_id=p_business_id AND bpm.payment_method='upi' AND bpm.is_active ORDER BY bpm.updated_at DESC LIMIT 1;
  IF v_bank_account IS NOT NULL THEN
    SELECT coalesce(jsonb_build_object('id',a.id,'code',a.code,'name',a.name,'account_subtype',a.account_subtype,'bank_account_id',ba.id),'{}'::jsonb) INTO v_upi FROM public.bank_accounts ba JOIN public.accounts a ON a.id=ba.linked_account_id WHERE ba.id=v_bank_account AND ba.business_id=p_business_id AND a.business_id=p_business_id AND a.is_active AND a.account_subtype='bank' LIMIT 1;
    SELECT coalesce(jsonb_build_object('name',ba.name,'institution_name',ba.institution_name,'account_last4',ba.account_last4),'{}'::jsonb) INTO v_upi_label FROM public.bank_accounts ba WHERE ba.id=v_bank_account AND ba.business_id=p_business_id LIMIT 1;
  END IF;
  SELECT coalesce(jsonb_build_object('tax_regime',tp.tax_regime,'gst_registration_type',tp.gst_registration_type,'gstin',tp.gstin),'{}'::jsonb) INTO v_profile FROM public.business_tax_profiles tp WHERE tp.business_id=p_business_id LIMIT 1;
  SELECT coalesce(se.offline_pos_enabled,false) INTO v_offline_enabled FROM public.saas_entitlements se WHERE se.business_id=p_business_id;
  RETURN jsonb_build_object('products',v_products,'taxes',v_taxes,'cash_account',coalesce(v_cash,'{}'::jsonb),'upi_account',coalesce(v_upi,'{}'::jsonb),'upi_label',coalesce(v_upi_label,'{}'::jsonb),'tax_profile',coalesce(v_profile,'{}'::jsonb),'offline_pos_enabled',v_offline_enabled);
END;
$fn$;

CREATE OR REPLACE FUNCTION public.sync_offline_cash_bill(p_business_id uuid,p_phone text,p_invoice_date date,p_items jsonb,p_payment_method public.payment_method,p_account_id uuid,p_invoice_discount_type text,p_invoice_discount_value numeric,p_notes text,p_terms text,p_temp_pos_uuid uuid,p_offline_ticket_number text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,mm_private AS $fn$
DECLARE v_enabled boolean; v_invoice uuid;
BEGIN
  SELECT coalesce(offline_pos_enabled,false) INTO v_enabled FROM public.saas_entitlements WHERE business_id=p_business_id;
  IF NOT v_enabled THEN RAISE EXCEPTION 'Offline POS is not enabled for this business plan.'; END IF;
  IF NOT mm_private.has_business_permission(p_business_id,'pos.cash_bill.create') THEN RAISE EXCEPTION 'Access denied'; END IF;
  v_invoice:=public.create_cash_bill(p_business_id,p_phone,p_invoice_date,p_items,p_payment_method,p_account_id,p_invoice_discount_type,p_invoice_discount_value,p_notes,p_terms,p_temp_pos_uuid,p_offline_ticket_number);
  RETURN v_invoice;
END;
$fn$;
REVOKE ALL ON FUNCTION public.sync_offline_cash_bill(uuid,text,date,jsonb,public.payment_method,uuid,text,numeric,text,text,uuid,text) FROM public,anon;
GRANT EXECUTE ON FUNCTION public.sync_offline_cash_bill(uuid,text,date,jsonb,public.payment_method,uuid,text,numeric,text,text,uuid,text) TO authenticated;
COMMIT;