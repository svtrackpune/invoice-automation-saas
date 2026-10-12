import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../', import.meta.url);
const read = (path) => readFile(new URL(path, root), 'utf8');

test('correction modal renders invoice editor core directly, without a nested workspace iframe', async () => {
  const modal = await read('app/next-workspace/invoices/InvoiceEditModal.tsx');
  const core = await read('app/next-workspace/invoices/InvoiceEditorCore.tsx');
  const page = await read('app/next-workspace/invoices/new/page.tsx');
  assert.match(modal, /import InvoiceEditorCore from '\.\/InvoiceEditorCore'/);
  assert.match(modal, /<InvoiceEditorCore documentId=\{invoiceId\} embedded documentKind=\{documentKind\} onCancel=\{onClose\} onSaved=\{onClose\} \/>/);
  assert.doesNotMatch(modal, /<iframe/);
  assert.match(page, /<InvoiceEditorCore \/>/);
  assert.match(core, /documentId\?: string/);
  assert.match(core, /onCancel\?: \(\) => void/);
});

test('posted invoice correction reverses the original journal and creates a separate corrected entry', async () => {
  const migration = await read('supabase/migrations/20261012150000_invoice_correction_reversal_flow.sql');
  const core = await read('app/next-workspace/invoices/InvoiceEditorCore.tsx');
  assert.match(core, /rpc\('rpc_correct_posted_invoice'/);
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.rpc_correct_posted_invoice/);
  assert.match(migration, /PERFORM public\.reverse_journal_entry\(/);
  assert.match(migration, /Invoice correction reversal for /);
  assert.match(migration, /'Invoice '\|\|inv\.invoice_number\|\|' \(corrected\)'/);
  assert.match(migration, /status='posted',posted_at=now\(\),posted_by=auth\.uid\(\)/);
  assert.match(migration, /v_new := \$new\$PERFORM pg_advisory_xact_lock/);
  assert.match(migration, /SET status='posted',posted_at=now\(\),posted_by=auth\.uid\(\)/);
});

test('metadata-only corrections skip journal reversal and each save increments the correction trail', async () => {
  const migration = await read('supabase/migrations/20261012150000_invoice_correction_reversal_flow.sql');
  assert.match(migration, /v_financial_change boolean := false/);
  assert.match(migration, /IF inv\.journal_entry_id IS NOT NULL AND v_financial_change THEN/);
  assert.match(migration, /correction_count=coalesce\(correction_count,0\)\+1/);
  assert.match(migration, /ADD COLUMN IF NOT EXISTS correction_count integer NOT NULL DEFAULT 0/);
  assert.match(migration, /correction_count >= 0/);
});

test('invoice correction API uses a same-origin endpoint and accounting reversal contract', async () => {
  const core = await read('app/next-workspace/invoices/InvoiceEditorCore.tsx');
  assert.match(core, /fetch\('\/api\/invoices\/dynamic'/);
  assert.match(core, /rpc\('rpc_correct_posted_invoice'/);
  assert.doesNotMatch(core, /fetch\(\s*['"]http:\/\//i);
});
