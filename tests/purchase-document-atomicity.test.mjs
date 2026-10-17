import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const read = (p) => readFile(new URL(p, root), 'utf8');

test('new purchase creation uses the atomic RPC rather than two independent inserts', async () => {
  const page = await read('app/next-workspace/purchases/new/page.tsx');
  assert.match(page, /supabase\.rpc\('create_purchase_document'/);
  assert.match(page, /p_items:payload/);
  assert.match(page, /p_po_status:isPO\?\(post\?'issued':'draft'\):null/);
  assert.doesNotMatch(page, /supabase\.from\('bill_items'\)\.insert\(/);
  assert.doesNotMatch(page, /supabase\.from\('bills'\)\.insert\(/);
});

test('atomic purchase RPC validates tenant, vendor, line inputs and reconciles header totals before committing', async () => {
  const migration = await read('supabase/migrations/20261017150000_atomic_purchase_document_create.sql');
  assert.match(migration, /SECURITY DEFINER/);
  assert.match(migration, /has_business_permission\(p_business_id, 'purchases\.manage', v_user_id\)/);
  assert.match(migration, /v\.id = p_vendor_id AND v\.business_id = p_business_id AND v\.is_active/);
  assert.match(migration, /Purchase lines require positive quantities and non-negative price, discount and tax values/);
  assert.match(migration, /Purchase product\/service is inactive, not purchasable, or belongs to another business/);
  assert.match(migration, /Purchase tax rate is inactive or belongs to another business/);
  assert.match(migration, /Purchase expense account is inactive or belongs to another business/);
  assert.match(migration, /Purchase document totals no longer match the validated line items/);
  assert.match(migration, /INSERT INTO public\.bills[\s\S]*?INSERT INTO public\.bill_items/);
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.create_purchase_document/);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.create_purchase_document/);
});
