import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const file = (p) => new URL(p, root);
const read = (p) => readFile(file(p), 'utf8');

test('financial correction migration contains required safety primitives', async () => {
  const sql = await read('supabase/migrations/20261001110000_transaction_correction_and_cash_bill_v1.sql');
  const markers = [
    'ADD COLUMN IF NOT EXISTS document_kind',
    'invoices_document_kind_check',
    'guard_invoice_void_with_payments',
    'update_customer_payment(',
    'create_cash_bill(',
    'update_cash_bill_any_state(',
    'v_other_alloc',
    'assert_accounting_period_open',
    'validate_journal_entry_balance',
    'REVOKE EXECUTE ON FUNCTION public.update_customer_payment',
    'REVOKE EXECUTE ON FUNCTION public.create_cash_bill',
    'REVOKE EXECUTE ON FUNCTION public.update_cash_bill_any_state',
  ];
  for (const marker of markers) assert.ok(sql.includes(marker), 'missing marker: ' + marker);
});

test('cash bill creation uses the atomic database workflow', async () => {
  const s = await read('app/next-workspace/cash-bill/page.tsx');
  assert.match(s, /rpc\('create_cash_bill'/);
  assert.doesNotMatch(s, /rpc\('create_invoice_from_items'/);
  assert.doesNotMatch(s, /rpc\('record_customer_payment'/);
});

test('cash bill correction is routed through the correction popup', async () => {
  const modal = await read('app/next-workspace/invoices/InvoiceEditModal.tsx');
  const review = await read('app/next-workspace/documents/DocumentReviewCenter.tsx');
  const editor = await read('app/next-workspace/invoices/new/page.tsx');
  assert.match(modal, /cash_bill=1/);
  assert.match(modal, /moneymatters:transaction-updated/);
  assert.match(review, /document_kind/);
  assert.match(review, /Edit Cash Bill/);
  assert.match(editor, /update_cash_bill_any_state/);
  assert.match(editor, /cashBillEdit/);
});

test('payment correction keeps cash bills inside their transaction workflow', async () => {
  const s = await read('app/next-workspace/payments/page.tsx');
  assert.match(s, /rpc\('update_customer_payment'/);
  assert.match(s, /Edit via Cash Bill/);
  assert.match(s, /account_id/);
});

test('global transaction surfaces expose the new document/payment model', async () => {
  const invoices = await read('app/next-workspace/invoices/page.tsx');
  const search = await read('app/next-workspace/GlobalSearch.tsx');
  assert.match(invoices, /document_kind/);
  assert.match(invoices, /Cash Bill/);
  assert.match(search, /supabase\.from\('payments'/);
  assert.match(search, /kind: 'payment'/);
});

test('production readiness workflow includes regression gates', async () => {
  const workflow = await read('.github/workflows/production-readiness.yml');
  assert.match(workflow, /npm run test:financial/);
  assert.match(workflow, /tests\/correction-contract\.test\.mjs/);
  const quality = await read('.github/workflows/final-quality-pass.yml');
  assert.match(quality, /contents: read/);
  assert.doesNotMatch(quality, /git push/);
});
