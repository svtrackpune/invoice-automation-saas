import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const migration = await readFile(
  new URL('../supabase/migrations/20261111093000_optimize_rls_auth_context_policy_initplans.sql', import.meta.url),
  'utf8',
);

test('RLS policy migration preflights all five expected authenticated policies', () => {
  for (const policy of [
    'daily_cash_shifts_select',
    'api_keys_member_insert',
    'webhook_subscriptions_member_insert',
    'business_communication_providers_manage',
    'communication_dispatch_logs_select',
  ]) {
    assert.ok(migration.includes(policy), `missing preflight/alter for ${policy}`);
  }
  assert.match(migration, /refusing to alter it/);
});

test('RLS auth context is statement-scoped without changing permission predicates', () => {
  assert.ok((migration.match(/\(SELECT auth\.uid\(\)\)/g) ?? []).length >= 8);
  for (const permission of [
    'reports.view',
    'accounting.view',
    'pos.cash_bill.create',
    'integrations.manage',
    'settings.manage',
    'sales.view',
  ]) {
    assert.ok(migration.includes(permission), `missing permission predicate ${permission}`);
  }
  assert.match(migration, /created_by = \(SELECT auth\.uid\(\)\)/);
});

test('RLS auth context optimization is transactional', () => {
  assert.match(migration, /^BEGIN;/);
  assert.match(migration, /COMMIT;\s*$/);
});
