import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const migration = await readFile(
  new URL('../supabase/migrations/20261111090500_restore_draft_quotation_currency_rpc.sql', import.meta.url),
  'utf8',
);
const editor = await readFile(
  new URL('../app/next-workspace/quotation/QuotationEditorCore.tsx', import.meta.url),
  'utf8',
);

test('draft quotation currency RPC matches the quotation editor named arguments', () => {
  assert.match(migration, /FUNCTION public\.set_draft_quotation_currency\(\s*p_quotation_id uuid,\s*p_currency_code text\s*\)/);
  assert.match(editor, /rpc\('set_draft_quotation_currency',\s*\{p_quotation_id:String\(id\),p_currency_code:quoteCurrency\}\)/);
});

test('draft quotation currency RPC is restricted to editable draft quotations', () => {
  assert.match(migration, /SECURITY DEFINER/);
  assert.match(migration, /SET search_path TO 'public','pg_temp'/);
  assert.match(migration, /FOR UPDATE/);
  assert.match(migration, /sales\.create/);
  assert.match(migration, /sales\.edit/);
  assert.match(migration, /q\.status <> 'draft' OR q\.invoice_id IS NOT NULL/);
  assert.match(migration, /v_currency !~ '\^\[A-Z\]\{3\}\$'/);
  assert.match(migration, /status='draft'[\s\S]*invoice_id IS NULL/);
});

test('draft quotation currency RPC is not executable by anon and is executable by authenticated', () => {
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.set_draft_quotation_currency\(uuid,text\) FROM PUBLIC, anon/);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.set_draft_quotation_currency\(uuid,text\) TO authenticated/);
});

test('migration is transactional and refreshes PostgREST schema cache', () => {
  assert.match(migration, /^BEGIN;/);
  assert.match(migration, /NOTIFY pgrst, 'reload schema'/);
  assert.match(migration, /COMMIT;\s*$/);
});
