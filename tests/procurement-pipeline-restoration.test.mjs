import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const read = (p) => readFile(new URL(p, root), 'utf8');

test('vendor email stays optional while supplied addresses remain normalized and validated', async () => {
  const migration = await read('supabase/migrations/20261016130000_restore_procurement_vendor_and_bill_item_rls.sql');
  const vendorPage = await read('app/next-workspace/vendors/page.tsx');

  assert.match(vendorPage, /Field label="Email"/);
  assert.match(vendorPage, /email:f\.email\.trim\(\)\|\|null/);
  assert.match(migration, /IF NULLIF\(BTRIM\(NEW\.email\), ''\) IS NULL THEN\s+NEW\.email := NULL;\s+RETURN NEW;/);
  assert.match(migration, /email address is invalid/);
  assert.match(migration, /NEW\.email := LOWER\(BTRIM\(NEW\.email\)\)/);
});

test('bill item mutations enforce parent draft state and procurement authorization without nested RLS lookup', async () => {
  const migration = await read('supabase/migrations/20261016130000_restore_procurement_vendor_and_bill_item_rls.sql');

  assert.match(migration, /CREATE OR REPLACE FUNCTION mm_private\.can_write_draft_bill\(p_bill_id uuid\)/);
  assert.match(migration, /SECURITY DEFINER\s+SET search_path TO 'public', 'mm_private', 'pg_temp'/);
  assert.match(migration, /b\.status = 'draft'::public\.bill_status/);
  assert.match(migration, /b\.journal_entry_id IS NULL/);
  assert.match(migration, /mm_private\.is_org_member\(mm_private\.business_org\(b\.business_id\)\)/);
  assert.match(migration, /mm_private\.has_business_permission\(b\.business_id, 'purchases\.manage'\)/);
  assert.match(migration, /REVOKE ALL ON FUNCTION mm_private\.can_write_draft_bill\(uuid\) FROM PUBLIC, anon/);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION mm_private\.can_write_draft_bill\(uuid\) TO authenticated/);
  assert.match(migration, /WITH CHECK \(mm_private\.can_write_draft_bill\(bill_id\)\)/);
  assert.match(migration, /USING \(mm_private\.can_write_draft_bill\(bill_id\)\)/);
});

test('procurement schema changes refresh PostgREST and remove anonymous table grants', async () => {
  const migration = await read('supabase/migrations/20261016130000_restore_procurement_vendor_and_bill_item_rls.sql');

  assert.match(migration, /REVOKE ALL ON TABLE public\.vendors FROM anon/);
  assert.match(migration, /REVOKE ALL ON TABLE public\.vendor_supply_mappings FROM anon/);
  assert.match(migration, /NOTIFY pgrst, 'reload schema'/);
});
