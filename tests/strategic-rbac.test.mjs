import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const root=new URL('../',import.meta.url);
const rbac=await readFile(new URL('lib/rbac.ts',root),'utf8');
const guard=await readFile(new URL('components/RoleRouteGuard.tsx',root),'utf8');
const migration=await readFile(new URL('supabase/migrations/20261003142550_strategic_gap_rbac_permissions_v1.sql',root),'utf8');
test('RBAC matrix grants cashier POS-only and auditor read-only permissions',()=>{assert.match(migration,/cashier','pos\.cash_bill\.create',true/);assert.match(migration,/auditor','accounting\.view',true/);assert.match(migration,/auditor','reports\.view',true/);assert.match(migration,/accounting\.post/);assert.match(migration,/payments\.pay/);});
test('UI route guard has role-specific route boundaries',()=>{assert.match(rbac,/cashier/);assert.match(rbac,/auditor/);assert.match(rbac,/accountant/);assert.match(guard,/Access restricted/);assert.match(guard,/canAccessRoute/);});
const posContextMigration = await readFile(new URL('supabase/migrations/20261004110000_fix_cash_bill_pos_context_authorization_v1.sql', root), 'utf8');
test('Cash Bill context uses the same POS authorization contract as checkout', () => {
  assert.match(posContextMigration, /set_config\('moneymatters\.pos_cash_bill','1',true\)/);
  assert.match(posContextMigration, /has_business_permission\(p_business_id,'sales\.create'\)/);
  assert.match(posContextMigration, /REVOKE ALL ON FUNCTION public\.get_cash_bill_pos_context\(uuid\) FROM public, anon/);
  assert.match(posContextMigration, /GRANT EXECUTE ON FUNCTION public\.get_cash_bill_pos_context\(uuid\) TO authenticated/);
});
