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

test('supplier credit lifecycle is server-controlled and credit-aware', async () => {
  const sql = await read('supabase/migrations/20261001160000_vendor_credit_lifecycle_v1.sql');
  const rls = await read('supabase/migrations/20261001161000_vendor_credit_rls_lockdown_v1.sql');
  const security = await read('supabase/migrations/20261001162000_vendor_credit_security_boundary_v1.sql');
  const paymentBoundary = await read('supabase/migrations/20261001163000_supplier_payment_account_boundary_v1.sql');
  const purchaseDetail = await read('app/next-workspace/purchases/[id]/page.tsx');
  const creditModal = await read('app/next-workspace/purchases/VendorCreditModal.tsx');
  const refundModal = await read('app/next-workspace/purchases/VendorRefundModal.tsx');
  const applyModal = await read('app/next-workspace/vendors/VendorCreditApplyModal.tsx');
  const vendor360 = await read('app/next-workspace/vendors/Vendor360Controlled.tsx');
  assert.match(sql, /ADD COLUMN IF NOT EXISTS bill_id/);
  assert.match(sql, /purchases\.manage/);
  assert.doesNotMatch(sql, /purchases\.create/);
  assert.match(sql, /create_and_post_vendor_credit/);
  assert.match(sql, /post_vendor_credit/);
  assert.match(sql, /apply_vendor_credit_to_bill/);
  assert.match(sql, /receive_vendor_refund/);
  assert.match(sql, /guard_vendor_payment_allocation_net_balance/);
  assert.match(sql, /recalculate_bill_settlement_state/);
  const currencyGuard = await read('supabase/migrations/20261001166000_vendor_credit_currency_guard_v1.sql');
  assert.match(currencyGuard, /currency does not match/);
  assert.match(currencyGuard, /b\.currency_code IS DISTINCT FROM vc\.currency_code/);
  assert.match(rls, /DROP POLICY IF EXISTS vendor_credits_access/);
  assert.match(rls, /DROP POLICY IF EXISTS vendor_credit_items_access/);
  assert.match(security, /REVOKE ALL ON FUNCTION public.recalculate_bill_settlement_state/);
  assert.match(security, /REVOKE ALL ON FUNCTION public.guard_vendor_payment_allocation_net_balance/);
  assert.match(security, /has_business_permission\(p_business_id,'accounting\.view'\)/);
  assert.match(paymentBoundary, /guard_vendor_bill_payment_account/);
  assert.match(paymentBoundary, /account_subtype IN \('cash','bank'\)/);
  assert.match(purchaseDetail, /account_subtype==='cash'\|\|a\.account_subtype==='bank'/);
  assert.match(purchaseDetail, /VendorCreditModal/);
  assert.match(purchaseDetail, /VendorRefundModal/);
  assert.match(purchaseDetail, /Transaction360Panel entityType="purchase_bill"/);
  assert.match(creditModal, /create_and_post_vendor_credit/);
  assert.match(refundModal, /receive_vendor_refund/);
  assert.match(applyModal, /apply_vendor_credit_to_bill/);
  assert.match(vendor360, /VendorCreditApplyModal/);
  assert.match(vendor360, /Available credit/);
});

test('customer 360 surfaces existing credit and refund ledgers', async () => {
  const customer360 = await read('app/next-workspace/customers/Customer360Controlled.tsx');
  assert.match(customer360, /customer_credit_ledger/);
  assert.match(customer360, /customer_refunds/);
  assert.match(customer360, /Available credit/);
  assert.match(customer360, /tab==='credits'/);
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

test('transaction 360 read model and UI are wired for sales and purchase documents', async () => {
  const sql = await read('supabase/migrations/20261001150000_transaction_360_read_model_v1.sql');
  const panel = await read('app/next-workspace/documents/Transaction360Panel.tsx');
  const review = await read('app/next-workspace/documents/DocumentReviewCenter.tsx');
  assert.match(sql, /get_transaction_360/);
  assert.match(sql, /source_quotation/);
  assert.match(sql, /inventory_movements/);
  assert.match(sql, /bank_transactions/);
  assert.match(panel, /get_transaction_360/);
  assert.match(panel, /purchase_bill/);
  assert.match(review, /Transaction360Panel/);
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
