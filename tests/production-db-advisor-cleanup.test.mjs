import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const migration = await readFile(
  new URL('../supabase/migrations/20261111090000_cleanup_duplicate_quotation_accept_index_and_entitlement_policy.sql', import.meta.url),
  'utf8',
);

test('duplicate-index cleanup verifies canonical and duplicate index definitions before dropping', () => {
  assert.match(migration, /to_regclass\('public\.quotations_public_accept_token_uidx'\)/);
  assert.match(migration, /to_regclass\('public\.quotations_public_accept_token_dispatch_uidx'\)/);
  assert.match(migration, /pg_get_indexdef\(v_keep_index\)/);
  assert.match(migration, /pg_get_indexdef\(v_duplicate_index\)/);
  assert.match(migration, /IS DISTINCT FROM v_duplicate_index_definition/);
  assert.match(migration, /DROP INDEX IF EXISTS public\.quotations_public_accept_token_dispatch_uidx/);
});

test('entitlement policy cleanup preserves the authenticated organization-membership policy', () => {
  assert.match(migration, /policyname = 'saas_entitlements_select'/);
  assert.match(migration, /policyname = 'saas_entitlements_member_select'/);
  assert.match(migration, /mm_private\.is_org_member/);
  assert.match(migration, /saas_entitlements\.business_id/);
  assert.match(migration, /DROP POLICY IF EXISTS saas_entitlements_member_select ON public\.saas_entitlements/);
});

test('production cleanup migration is transactional', () => {
  assert.match(migration, /^BEGIN;/);
  assert.match(migration, /COMMIT;\s*$/);
});
