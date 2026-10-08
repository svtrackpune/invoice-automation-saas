BEGIN;

CREATE OR REPLACE FUNCTION public.run_business_health_check(p_business_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, mm_private, pg_temp
AS $$
DECLARE
  v_user UUID := auth.uid();
  v_total_debits NUMERIC := 0;
  v_total_credits NUMERIC := 0;
  v_orphaned_stock_count INT := 0;
  v_corrupted_po_count INT := 0;
  v_invalid_document_pref_count INT := 0;
  v_payment_integrity_count INT := 0;
  v_payment_settings public.document_payment_settings%ROWTYPE;
  v_has_payment_settings BOOLEAN := FALSE;
  v_is_healthy BOOLEAN := TRUE;
  v_issues JSONB := '[]'::jsonb;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  IF NOT mm_private.has_business_permission(p_business_id, 'settings.manage', v_user) THEN
    RAISE EXCEPTION 'Access denied: insufficient permissions to run diagnostics';
  END IF;

  SELECT COALESCE(SUM(jl.debit),0),COALESCE(SUM(jl.credit),0)
  INTO v_total_debits,v_total_credits
  FROM public.journal_lines jl
  JOIN public.journal_entries je ON je.id=jl.journal_entry_id
  WHERE je.business_id=p_business_id AND je.status='posted';

  IF round(v_total_debits,2)<>round(v_total_credits,2) THEN
    v_is_healthy:=FALSE;
    v_issues:=v_issues||jsonb_build_array(jsonb_build_object('severity','CRITICAL','code','LEDGER_IMBALANCE','message',format('Trial balance mismatch: Debits = %s, Credits = %s',v_total_debits,v_total_credits)));
  END IF;

  SELECT COUNT(*) INTO v_orphaned_stock_count
  FROM public.inventory_movements im
  LEFT JOIN public.products_services ps ON ps.id=im.product_service_id
  LEFT JOIN public.inventory_locations il ON il.id=im.location_id
  WHERE im.business_id=p_business_id
    AND (ps.id IS NULL OR il.id IS NULL OR ps.business_id<>p_business_id OR il.business_id<>p_business_id);

  IF v_orphaned_stock_count>0 THEN
    v_is_healthy:=FALSE;
    v_issues:=v_issues||jsonb_build_array(jsonb_build_object('severity','CRITICAL','code','ORPHANED_INVENTORY_MOVEMENT','message',format('%s inventory movements reference missing or cross-business products/locations',v_orphaned_stock_count)));
  END IF;

  SELECT COUNT(*) INTO v_corrupted_po_count
  FROM public.bills b
  WHERE b.business_id=p_business_id AND b.is_purchase_order=TRUE
    AND (b.journal_entry_id IS NOT NULL OR EXISTS(SELECT 1 FROM public.journal_entries je WHERE je.business_id=p_business_id AND je.source_id=b.id AND je.status='posted'));

  IF v_corrupted_po_count>0 THEN
    v_is_healthy:=FALSE;
    v_issues:=v_issues||jsonb_build_array(jsonb_build_object('severity','CRITICAL','code','PO_LEDGER_LEAK','message',format('%s Purchase Orders have journal entanglements',v_corrupted_po_count)));
  END IF;

  SELECT COUNT(*) INTO v_invalid_document_pref_count
  FROM public.business_document_preferences p
  LEFT JOIN public.document_templates t ON t.id=p.template_id
  WHERE p.business_id=p_business_id AND (t.id IS NULL OR t.is_active IS DISTINCT FROM TRUE OR t.document_type<>p.document_type);

  IF v_invalid_document_pref_count>0 THEN
    v_is_healthy:=FALSE;
    v_issues:=v_issues||jsonb_build_array(jsonb_build_object('severity','HIGH','code','DOCUMENT_PREFERENCE_INVALID','message',format('%s document preferences reference missing, inactive, or mismatched templates',v_invalid_document_pref_count)));
  END IF;

  SELECT * INTO v_payment_settings FROM public.document_payment_settings WHERE business_id=p_business_id;
  v_has_payment_settings:=FOUND;

  IF v_has_payment_settings AND v_payment_settings.default_bank_account_id IS NOT NULL THEN
    SELECT COUNT(*) INTO v_payment_integrity_count FROM public.bank_accounts ba
    WHERE ba.id=v_payment_settings.default_bank_account_id AND (ba.business_id<>p_business_id OR ba.is_active IS DISTINCT FROM TRUE);
    IF v_payment_integrity_count>0 THEN
      v_is_healthy:=FALSE;
      v_issues:=v_issues||jsonb_build_array(jsonb_build_object('severity','HIGH','code','PAYMENT_BANK_INVALID','message','Default settlement bank is inactive or belongs to another business'));
    END IF;
  END IF;

  IF NOT v_has_payment_settings THEN
    v_issues:=v_issues||jsonb_build_array(jsonb_build_object('severity','WARNING','code','PAYMENT_SETTINGS_MISSING','message','Payment settings have not been configured'));
  ELSIF v_payment_settings.enable_upi AND (v_payment_settings.upi_id IS NULL OR btrim(v_payment_settings.upi_id)='' OR v_payment_settings.upi_id !~ '^[[:alnum:]_.-]+@[[:alnum:]_.-]+$') THEN
    v_issues:=v_issues||jsonb_build_array(jsonb_build_object('severity','WARNING','code','UPI_NOT_CONFIGURED','message','UPI is enabled but the VPA is missing or invalid'));
  END IF;

  RETURN jsonb_build_object(
    'healthy',v_is_healthy,'checked_at',now(),
    'trial_balance',jsonb_build_object('debits',round(v_total_debits,2),'credits',round(v_total_credits,2),'balanced',round(v_total_debits,2)=round(v_total_credits,2)),
    'checks',jsonb_build_object('orphaned_inventory_movements',v_orphaned_stock_count,'po_ledger_entanglements',v_corrupted_po_count,'invalid_document_preferences',v_invalid_document_pref_count,'payment_settings_present',v_has_payment_settings),
    'issues',v_issues
  );
END;
$$;

REVOKE ALL ON FUNCTION public.run_business_health_check(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.run_business_health_check(uuid) TO authenticated;

COMMIT;
