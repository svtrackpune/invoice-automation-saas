import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const read = (path) => readFile(new URL(path, root), 'utf8');

test('invoice posting creates a draft journal and transitions to posted after all lines', async () => {
  const migration = await read('supabase/migrations/20261012180000_fix_invoice_ledger_posting_idempotency.sql');

  assert.match(migration, /public\.post_invoice\(uuid,uuid\)::regprocedure/);
  assert.match(migration, /v_old := \$old\$\s+'posted',[\s\S]*?inv\.currency_code,\$old\$/);
  assert.match(migration, /v_new := \$new\$\s+'draft',[\s\S]*?inv\.currency_code,\$new\$/);
  assert.match(migration, /UPDATE public\.journal_entries[\s\S]*?SET status = 'posted',[\s\S]*?WHERE id = v_entry[\s\S]*?AND status = 'draft'/);
  assert.match(migration, /PERFORM public\.validate_journal_entry_balance\(v_entry\)/);
  assert.match(migration, /journal_lines insert finishes/);
});

test('invoice posting retry reuses only a same-business, balanced posted journal', async () => {
  const migration = await read('supabase/migrations/20261012180000_fix_invoice_ledger_posting_idempotency.sql');

  assert.match(migration, /source_type = 'invoice'[\s\S]*?source_id = inv\.id[\s\S]*?FOR UPDATE/);
  assert.match(migration, /v_existing_entry_status IS DISTINCT FROM 'posted'/);
  assert.match(migration, /PERFORM public\.validate_journal_entry_balance\(v_entry\)/);
  assert.match(migration, /SET journal_entry_id = v_entry,[\s\S]*?status = CASE/);
  assert.match(migration, /Invoice journal uniqueness conflict could not be resolved/);
  assert.match(migration, /refusing to duplicate or append ledger lines/);
});

test('migration preserves ledger guards and avoids direct posted-line writes', async () => {
  const migration = await read('supabase/migrations/20261012180000_fix_invoice_ledger_posting_idempotency.sql');
  assert.match(migration, /pg_get_functiondef\(v_target\)/);
  assert.match(migration, /EXECUTE v_definition/);
  assert.match(migration, /SET status = ''posted''/);
  assert.doesNotMatch(migration, /DROP TRIGGER|DISABLE TRIGGER|fn_guard_posted_journal_line_insert/);
});
