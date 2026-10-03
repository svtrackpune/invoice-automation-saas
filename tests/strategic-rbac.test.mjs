import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root=new URL('../',import.meta.url);
const roles=await readFile(new URL('supabase/migrations/20261003142500_strategic_gap_rbac_roles_v1.sql',root),'utf8');
const perms=await readFile(new URL('supabase/migrations/20261003143000_strategic_gap_rbac_entitlements_v1.sql',root),'utf8');
const entitlement=await readFile(new URL('supabase/migrations/20261003142900_saas_entitlements_v1.sql',root),'utf8');
const enforce=await readFile(new URL('supabase/migrations/20261003143500_strategic_gap_entitlement_enforcement_v1.sql',root),'utf8');
const guard=await readFile(new URL('components/RoleRouteGuard.tsx',root),'utf8');
const rbac=await readFile(new URL('lib/rbac.ts',root),'utf8');

test('role model adds cashier and auditor without replacing existing roles',()=>{
  assert.match(roles,/member_role ADD VALUE IF NOT EXISTS 'cashier'/);
  assert.match(roles,/member_role ADD VALUE IF NOT EXISTS 'auditor'/);
  assert.match(perms,/owner/);
  assert.match(perms,/admin/);
  assert.match(perms,/accountant/);
});

test('cashier is limited to POS and not generic financial permissions',()=>{
  assert.match(perms,/pos\.cash_bill\.create/);
  assert.match(perms,/DELETE FROM public\.role_permissions WHERE role='cashier'/);
  assert.doesNotMatch(perms,/role='cashier'[^\n]*sales\.create/);
  assert.match(enforce,/moneymatters\.pos_cash_bill/);
  assert.match(enforce,/pos\.cash_bill\.create/);
});

test('auditor gets read-only workspaces and accountant remains separate',()=>{
  assert.match(perms,/auditor.*accounting\.view/s);
  assert.match(perms,/auditor.*reports\.view/s);
  assert.doesNotMatch(rbac,/\/next-workspace\/banking'.*auditor/s);
});

test('route guard and UI route policy use database-backed access',()=>{
  assert.match(guard,/get_my_business_access/);
  assert.match(guard,/cashierAllowed/);
  assert.match(guard,/auditorAllowed/);
  assert.match(rbac,/canSeeRoute/);
});

test('SaaS entitlements are private and business-scoped',()=>{
  assert.match(entitlement,/CREATE TABLE IF NOT EXISTS public\.saas_entitlements/);
  assert.match(entitlement,/api_enabled boolean NOT NULL DEFAULT true/);
  assert.match(entitlement,/e_invoicing_enabled boolean NOT NULL DEFAULT false/);
  assert.match(entitlement,/offline_pos_enabled boolean NOT NULL DEFAULT false/);
  assert.match(entitlement,/REVOKE INSERT,UPDATE,DELETE ON public\.saas_entitlements FROM anon,authenticated/);
  assert.match(enforce,/offline_pos_enabled/);
});