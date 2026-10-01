import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const file = (p) => new URL(p, root);
const read = (p) => readFile(file(p), 'utf8');

test('financial correction migration contains required safety primitives', async () => {
  const sql = await read('supabase/migrations/20261001110000_transaction_correction_and_cash_bill_v1.sql');
  const purchase = await read('supabase/migrations/20261001120000_purchase_expense_correction_v1.sql');
  const boundary = await read('supabase/migrations/20261001130000_correction_boundary_v1.sql');
  const markers = [
    'ADD COLUMN IF NOT EXISTS document_kind',
    'invoices_document_kind_check',
    'guard_invoice_void_with_payments',
    'update_customer_payment(',
    'update_bill_any_state(',
    'update_vendor_payment(',
    'update_expense_any_state(',
    'create_cash_bill(',
    'update_cash_bill_any_state(',
    'v_other_alloc',
    'assert_accounting_period_open',
    'validate_journal_entry_balance',
    'REVOKE EXECUTE ON FUNCTION public.update_customer_payment',
    'REVOKE EXECUTE ON FUNCTION public.create_cash_bill',
    'REVOKE EXECUTE ON FUNCTION public.update_cash_bill_any_state',
  ];
  for (const marker of markers.slice(0, 4).concat(markers.slice(7, 10)).concat(markers.slice(10))) assert.ok(sql.includes(marker), 'missing marker in sales migration: ' + marker);
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

test('purchase and expense correction surfaces use the server correction contract', async () => {
  const purchaseEditor = await read('app/next-workspace/purchases/new/page.tsx');
  const purchaseModal = await read('app/next-workspace/purchases/PurchaseEditModal.tsx');
  const purchaseDetail = await read('app/next-workspace/purchases/[id]/page.tsx');
  const expenses = await read('app/next-workspace/expenses/ExpenseWorkspaceControlled.tsx');
  const sql = await read('supabase/migrations/20261001120000_purchase_expense_correction_v1.sql');
  assert.match(purchaseEditor, /update_bill_any_state/);
  assert.match(purchaseEditor, /embedded/);
  assert.match(purchaseModal, /moneymatters:transaction-updated/);
  assert.match(purchaseDetail, /PurchaseEditModal/);
  assert.match(purchaseDetail, /update_vendor_payment/);
  assert.match(expenses, /update_expense_any_state/);
  assert.match(expenses, /Correct expense/);
  assert.match(sql, /guard_bill_void_with_payments/);
  assert.match(sql, /update_bill_any_state/);
  assert.match(sql, /update_vendor_payment/);
  assert.match(sql, /update_expense_any_state/);
  const boundary = await read('supabase/migrations/20261001130000_correction_boundary_v1.sql');
  assert.match(boundary, /update_regular_invoice_any_state/);
  assert.match(boundary, /Cash Bills must be corrected through the Cash Bill settlement workflow/);
  assert.match(boundary, /REVOKE EXECUTE ON FUNCTION public.update_invoice_any_state/);
  assert.match(sql, /reverse_journal_entry/);
});

test('global transaction surfaces expose the new document/payment model', async () => {
  const invoices = await read('app/next-workspace/invoices/page.tsx');
  const search = await read('app/next-workspace/GlobalSearch.tsx');
  assert.match(invoices, /document_kind/);
  assert.match(invoices, /Cash Bill/);
  assert.match(search, /supabase\.from\('payments'/);
  assert.match(search, /kind: 'payment'/);
});

test('core financial audit coverage is installed', async () => {
  const sql = await read('supabase/migrations/20261001140000_core_financial_audit_v1.sql');
  for (const marker of ['trg_audit_invoices','trg_audit_bills','trg_audit_expenses','trg_audit_receipts','trg_audit_invoice_items','trg_audit_bill_items','audit_financial_row']) {
    assert.ok(sql.includes(marker), 'missing audit marker: '+marker);
  }
});

test('quotation audit coverage is installed', async () => {
  const sql = await read('supabase/migrations/20261001150000_quotation_audit_v1.sql');
  assert.match(sql, /trg_audit_quotations/);
  assert.match(sql, /trg_audit_quotation_items/);
  assert.match(sql, /audit_financial_row/);
});

test('financial reconciliation guard is included', async () => {
  const sql = await read('supabase/migrations/20261001140000_financial_integrity_summary_v1.sql');
  assert.match(sql, /get_financial_integrity_summary/);
  for (const marker of ['invoice_balance_mismatches','invoice_allocation_mismatches','bill_balance_mismatches','bill_allocation_mismatches','unbalanced_posted_journals','negative_inventory_balances','unsettled_cash_bills']) {
    assert.ok(sql.includes(marker), 'missing reconciliation marker: '+marker);
  }
});

test('production readiness workflow includes regression gates', async () => {
  const workflow = await read('.github/workflows/production-readiness.yml');
  assert.match(workflow, /npm run test:financial/);
  assert.match(workflow, /tests\/correction-contract\.test\.mjs/);
  const quality = await read('.github/workflows/final-quality-pass.yml');
  assert.match(quality, /contents: read/);
  assert.doesNotMatch(quality, /git push/);
});
