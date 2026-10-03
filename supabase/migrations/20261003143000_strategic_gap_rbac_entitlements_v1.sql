BEGIN;

INSERT INTO public.role_permissions(role,permission_key,allowed) VALUES
  ('owner','ownership.manage',true),('admin','ownership.manage',true),
  ('cashier','pos.cash_bill.create',true),
  ('auditor','dashboard.view',true),('auditor','sales.view',true),('auditor','accounting.view',true),
  ('auditor','reports.view',true),('auditor','documents.view',true),
  ('auditor','inventory.view',true),('auditor','tax.view',true)
ON CONFLICT(role,permission_key) DO UPDATE SET allowed=excluded.allowed;

INSERT INTO public.role_permissions(role,permission_key,allowed)
SELECT r.role,p.permission_key,false
FROM unnest(enum_range(NULL::public.member_role)) AS r(role)
CROSS JOIN (VALUES ('customers.view'),('vendors.view'),('purchases.view'),('expenses.view'),('payments.view'),('tax.view'),('pos.cash_bill.create'),('ownership.manage')) AS p(permission_key)
ON CONFLICT(role,permission_key) DO NOTHING;

UPDATE public.role_permissions rp SET allowed=true
WHERE rp.permission_key IN ('customers.view','vendors.view','purchases.view','expenses.view','payments.view','tax.view')
  AND rp.role IN ('owner','admin','accountant');

DELETE FROM public.role_permissions
WHERE role='cashier'
  AND permission_key IN (
    'sales.create','sales.edit','sales.send','sales.void',
    'customers.manage','vendors.manage','purchases.manage','expenses.manage',
    'reports.view','accounting.view','banking.view','settings.manage',
    'tax.manage','integrations.manage','users.manage','branding.manage'
  );

CREATE OR REPLACE FUNCTION mm_private.has_business_permission(
  p_business_id uuid,p_permission text,p_user_id uuid DEFAULT auth.uid()
) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path=public,mm_private
AS $fn$
  SELECT EXISTS(
    SELECT 1
    FROM public.businesses b
    WHERE b.id=p_business_id
      AND (
        mm_private.has_permission(b.organization_id,p_permission,p_user_id)
        OR (
          p_permission='sales.create'
          AND current_setting('moneymatters.pos_cash_bill',true)='1'
          AND EXISTS(
            SELECT 1
            FROM public.organization_members om
            WHERE om.organization_id=b.organization_id
              AND om.user_id=p_user_id
              AND om.is_active
              AND om.role='cashier'
          )
          AND mm_private.has_permission(b.organization_id,'pos.cash_bill.create',p_user_id)
        )
      )
  );
$fn$;

REVOKE ALL ON FUNCTION mm_private.has_business_permission(uuid,text,uuid) FROM public,anon,authenticated;

CREATE OR REPLACE FUNCTION public.get_my_business_access(p_business_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path=public,mm_private
AS $fn$
DECLARE v_org uuid; v_role public.member_role; v_permissions jsonb;
BEGIN
  SELECT b.organization_id,om.role
  INTO v_org,v_role
  FROM public.businesses b
  JOIN public.organization_members om
    ON om.organization_id=b.organization_id
   AND om.user_id=auth.uid()
   AND om.is_active
  WHERE b.id=p_business_id;
  IF v_org IS NULL THEN RAISE EXCEPTION 'Business access denied'; END IF;
  SELECT coalesce(jsonb_object_agg(permission_key,allowed),'{}'::jsonb)
    INTO v_permissions
  FROM public.role_permissions
  WHERE role=v_role;
  RETURN jsonb_build_object('business_id',p_business_id,'role',v_role::text,'permissions',v_permissions);
END;
$fn$;

REVOKE ALL ON FUNCTION public.get_my_business_access(uuid) FROM public,anon;
GRANT EXECUTE ON FUNCTION public.get_my_business_access(uuid) TO authenticated;

COMMIT;