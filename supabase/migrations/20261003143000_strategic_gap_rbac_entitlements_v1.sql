BEGIN;

ALTER TYPE public.member_role ADD VALUE IF NOT EXISTS 'cashier';
ALTER TYPE public.member_role ADD VALUE IF NOT EXISTS 'auditor';

INSERT INTO public.role_permissions(role,permission_key,allowed) VALUES
  ('owner','ownership.manage',true),('admin','ownership.manage',true),
  ('cashier','dashboard.view',true),('cashier','inventory.view',true),('cashier','pos.cash_bill.create',true),
  ('cashier','sales.view',true),
  ('auditor','dashboard.view',true),('auditor','sales.view',true),('auditor','accounting.view',true),
  ('auditor','reports.view',true),('auditor','documents.view',true),('auditor','payments.receive',true),
  ('auditor','inventory.view',true),('auditor','tax.view',true)
ON CONFLICT(role,permission_key) DO UPDATE SET allowed=excluded.allowed;

-- Add explicit read permissions for route/UI policy decisions. Existing mutation grants are untouched.
INSERT INTO public.role_permissions(role,permission_key,allowed)
SELECT r.role,p.permission_key,false
FROM unnest(enum_range(NULL::public.member_role)) AS r(role)
CROSS JOIN (VALUES ('customers.view'),('vendors.view'),('purchases.view'),('expenses.view'),('payments.view'),('tax.view'),('pos.cash_bill.create'),('ownership.manage')) AS p(permission_key)
ON CONFLICT(role,permission_key) DO NOTHING;

UPDATE public.role_permissions rp SET allowed=true
WHERE rp.permission_key IN ('customers.view','vendors.view','purchases.view','expenses.view','payments.view','tax.view')
  AND rp.role IN ('owner','admin','accountant');

-- Cashier is deliberately not granted generic sales.create; only the POS Cash Bill context below may satisfy it.
DELETE FROM public.role_permissions WHERE role='cashier' AND permission_key IN ('sales.create','sales.edit','sales.send','sales.void','customers.manage','vendors.manage','purchases.manage','expenses.manage','reports.view','accounting.view','banking.view','settings.manage','tax.manage','integrations.manage','users.manage','branding.manage');

CREATE OR REPLACE FUNCTION mm_private.has_business_permission(
  p_business_id uuid,p_permission text,p_user_id uuid DEFAULT auth.uid()
) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,mm_private AS $fn$
  SELECT EXISTS(
    SELECT 1
    FROM public.businesses b
    JOIN public.organization_members om ON om.organization_id=b.organization_id
    LEFT JOIN public.member_permissions mp ON mp.organization_id=om.organization_id AND mp.user_id=om.user_id AND mp.permission_key=p_permission
    LEFT JOIN public.role_permissions rp ON rp.role=om.role AND rp.permission_key=p_permission
    WHERE b.id=p_business_id AND om.user_id=p_user_id AND om.is_active
      AND CASE
        WHEN om.role='cashier' AND p_permission='sales.create' THEN
          current_setting('moneymatters.pos_cash_bill',true)='1'
          AND coalesce(mp.allowed,rp.allowed,false)=true
          AND EXISTS (SELECT 1 FROM public.role_permissions rpx WHERE rpx.role='cashier' AND rpx.permission_key='pos.cash_bill.create' AND rpx.allowed)
        ELSE coalesce(mp.allowed,rp.allowed,false)
      END
  );
$fn$;

REVOKE ALL ON FUNCTION mm_private.has_business_permission(uuid,text,uuid) FROM public,anon,authenticated;

-- Permit a cashier to enter the existing Cash Bill financial RPC only through its own trusted POS context.
CREATE OR REPLACE FUNCTION public.create_cash_bill(
  p_business_id uuid,p_phone text,p_invoice_date date,p_items jsonb,p_payment_method public.payment_method,
  p_account_id uuid,p_invoice_discount_type text DEFAULT NULL,p_invoice_discount_value numeric DEFAULT 0,
  p_notes text DEFAULT 'Cash & Carry',p_terms text DEFAULT 'Paid in full at counter.'
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,mm_private AS $fn$
DECLARE v_customer uuid; v_invoice uuid;
BEGIN
  PERFORM set_config('moneymatters.pos_cash_bill','1',true);
  IF NOT mm_private.has_business_permission(p_business_id,'sales.create') THEN RAISE EXCEPTION 'Access denied'; END IF;
  IF p_payment_method NOT IN ('cash','upi') THEN RAISE EXCEPTION 'Cash Bill settlement must be Cash or UPI.'; END IF;
  IF p_payment_method='cash' AND NOT EXISTS(SELECT 1 FROM public.accounts WHERE id=p_account_id AND business_id=p_business_id AND is_active AND account_subtype='cash') THEN RAISE EXCEPTION 'Select a Cash settlement account for a Cash Bill paid by cash.'; END IF;
  IF p_payment_method='upi' AND NOT EXISTS(SELECT 1 FROM public.accounts WHERE id=p_account_id AND business_id=p_business_id AND is_active AND account_subtype='bank') THEN RAISE EXCEPTION 'Select a Bank settlement account for a Cash Bill paid by UPI.'; END IF;
  v_customer:=public.get_or_create_cash_customer_by_phone(p_business_id,p_phone);
  v_invoice:=public.create_invoice_from_items(p_business_id,v_customer,p_invoice_date,p_invoice_date,p_items,p_invoice_discount_type,p_invoice_discount_value,p_notes,p_terms);
  UPDATE public.invoices SET document_kind='cash_bill',payment_display_mode='none',payment_bank_account_id=NULL,updated_at=now() WHERE id=v_invoice;
  PERFORM public.post_invoice(v_invoice,NULL);
  PERFORM public.record_customer_payment(p_business_id,v_customer,v_invoice,(SELECT total FROM public.invoices WHERE id=v_invoice),p_payment_method,p_account_id,NULL,NULL,p_invoice_date,p_notes);
  RETURN v_invoice;
END; $fn$;

REVOKE EXECUTE ON FUNCTION public.create_cash_bill(uuid,text,date,jsonb,public.payment_method,uuid,text,numeric,text,text) FROM public,anon;
GRANT EXECUTE ON FUNCTION public.create_cash_bill(uuid,text,date,jsonb,public.payment_method,uuid,text,numeric,text,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_my_business_access(p_business_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,mm_private AS $fn$
DECLARE v_org uuid; v_role public.member_role; v_permissions jsonb;
BEGIN
  SELECT b.organization_id,om.role INTO v_org,v_role FROM public.businesses b JOIN public.organization_members om ON om.organization_id=b.organization_id AND om.user_id=auth.uid() AND om.is_active WHERE b.id=p_business_id;
  IF v_org IS NULL THEN RAISE EXCEPTION 'Business access denied'; END IF;
  SELECT coalesce(jsonb_object_agg(permission_key,allowed),'{}'::jsonb) INTO v_permissions
  FROM public.role_permissions WHERE role=v_role;
  RETURN jsonb_build_object('business_id',p_business_id,'role',v_role::text,'permissions',v_permissions);
END;
$fn$;
REVOKE ALL ON FUNCTION public.get_my_business_access(uuid) FROM public,anon;
GRANT EXECUTE ON FUNCTION public.get_my_business_access(uuid) TO authenticated;

COMMIT;