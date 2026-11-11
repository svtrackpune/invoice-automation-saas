import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const migration = await readFile(
  new URL('../supabase/migrations/20261111075030_bank_reversal_context_rls_lockdown.sql', import.meta.url),
  'utf8',
);

test('bank reversal context is private, RLS-enabled, and unavailable to API roles', () => {
  assert.match(migration, /REVOKE ALL ON TABLE mm_private\.bank_reversal_context\s+FROM PUBLIC, anon, authenticated, service_role/);
  assert.match(migration, /ALTER TABLE mm_private\.bank_reversal_context\s+ENABLE ROW LEVEL SECURITY/);
  assert.match(migration, /ALTER TABLE mm_private\.bank_reversal_context\s+NO FORCE ROW LEVEL SECURITY/);
  assert.doesNotMatch(migration, /CREATE POLICY/i);
  for (const role of ['anon', 'authenticated', 'service_role']) {
    assert.match(migration, new RegExp(`has_table_privilege\\('${role}', 'mm_private\\.bank_reversal_context'`));
  }
});

test('internal bank reversal access stays behind postgres-owned definer routines and business authorization', () => {
  assert.match(migration, /reverse_locked_bank_reconciliation\(uuid,uuid,text,date\)/);
  assert.match(migration, /prevent_locked_reconciliation_mutation\(\)/);
  assert.match(migration, /v_reversal_owner <> v_table_owner/);
  assert.match(migration, /v_trigger_owner <> v_table_owner/);
  assert.match(migration, /mm_private\.has_business_permission/);
  assert.match(migration, /accounting\.adjust/);
  assert.match(migration, /FORCE RLS must remain disabled/);
});
