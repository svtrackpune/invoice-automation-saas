BEGIN;

-- Operational roles reuse the existing permission engine. These are deny-by-default;
-- only the documented permissions below are granted.
INSERT INTO public.role_permissions(role,permission_key,allowed) VALUES
  ('cashier','pos.cash_bill.create',true),
  ('auditor','dashboard.view',true),
  ('auditor','customers.view',true),
  ('auditor','vendors.view',true),
  ('auditor','sales.view',true),
  ('auditor','payments.view',true),
  ('auditor','documents.view',true),
  ('auditor','inventory.view',true),
  ('auditor','purchases.view',true),
  ('auditor','expenses.view',true),
  ('auditor','accounting.view',true),
  ('auditor','reports.view',true),
  ('auditor','tax.view',true)
ON CONFLICT(role,permission_key) DO UPDATE SET allowed=EXCLUDED.allowed;

-- Explicitly deny mutation/integration/ownership actions for the two operational roles.
INSERT INTO public.role_permissions(role,permission_key,allowed)
SELECT r.role,p.permission_key,false
FROM (VALUES ('cashier'::public.member_role),('auditor'::public.member_role)) AS r(role)
CROSS JOIN (VALUES
  ('customers.manage'),('vendors.manage'),('purchases.manage'),('expenses.manage'),
  ('payments.pay'),('sales.create'),('sales.edit'),('sales.send'),('sales.void'),
  ('accounting.adjust'),('accounting.post'),('banking.reconcile'),('banking.view'),
  ('tax.manage'),('inventory.manage'),('settings.manage'),('branding.manage'),
  ('integrations.manage'),('users.manage'),('documents.manage'),('automation.manage'),
  ('pricing.manage'),('payroll.manage'),('ownership.manage')
) AS p(permission_key)
ON CONFLICT(role,permission_key) DO UPDATE SET allowed=FALSE;

COMMIT;