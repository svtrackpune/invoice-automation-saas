import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const migration = readFileSync(
  'supabase/migrations/20261009150000_security_and_performance_hardening.sql',
  'utf8',
);

test('SECURITY DEFINER search paths are pinned with pg_temp last and existing schemas preserved', () => {
  assert.match(migration, /n\.nspname IN \('public', 'mm_private'\)/);
  assert.match(migration, /p\.prosecdef/);
  assert.match(migration, /p\.prokind IN \('f', 'p'\)/);
  assert.match(migration, /ALTER FUNCTION %I\.%I\(%s\) SET search_path TO %s/);
  assert.match(migration, /ALTER PROCEDURE %I\.%I\(%s\) SET search_path TO %s/);
  assert.match(migration, /rtrim\(v_current_path\) \|\| ', pg_temp'/);
  assert.match(migration, /v_new_path := 'public, pg_temp'/);
  assert.match(migration, /v_new_path := 'public, mm_private, pg_temp'/);
  assert.match(migration, /SECURITY DEFINER search-path hardening incomplete/);
  assert.match(migration, /pg_temp\[\[:space:\]\]\*\$'/);
});

test('deliberately empty search paths remain unchanged', () => {
  assert.match(migration, /Keep intentionally empty search paths intact/);
  assert.match(migration, /IF v_current_path IN \('', '""'\) THEN\s+CONTINUE;/);
  assert.match(migration, /NOT IN \('', '""'\)/);
});

test('temporary payment-allocation objects remain explicitly qualified after pg_temp moves last', () => {
  assert.match(migration, /public\.allocate_vendor_payment/);
  assert.match(migration, /replace\(\s+v_definition,\s+'_vendor_payment_target_allocations',\s+'pg_temp\._vendor_payment_target_allocations'/s);
  assert.match(migration, /temporary-table qualification check failed/);
});

test('migration is transactional and safely repeatable', () => {
  assert.match(migration, /^BEGIN;/);
  assert.match(migration, /COMMIT;\s*$/);
  assert.match(migration, /already-hardened paths have pg_temp explicitly last/);
});
