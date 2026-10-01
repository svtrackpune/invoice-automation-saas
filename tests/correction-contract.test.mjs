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
  assert.match(customer360, /tab\s*===\s*['"]credits['"]/);
});

test('sales credit note lifecycle is server-controlled', async () => {
  const sql = await read('supabase/migrations/20261001170000_sales_credit_note_boundary_v1.sql');
  const atomic = await read('supabase/migrations/20261001171000_sales_credit_note_atomic_v1.sql');
  const customerSecurity = await read('supabase/migrations/20261001172000_customer_credit_security_boundary_v1.sql');
  const sales360 = await read('supabase/migrations/20261001173000_transaction_360_sales_credit_v1.sql');
  const modal = await read('app/next-workspace/documents/CreditNoteModal.tsx');
  const review = await read('app/next-workspace/documents/DocumentReviewCenter.tsx');
  assert.match(sql, /create_credit_note\(/);
  assert.match(sql, /post_credit_note\(/);
  assert.match(sql, /invoice item does not belong to the source invoice/);
  assert.match(sql, /uncredited source quantity/);
  assert.match(sql, /assert_accounting_period_open/);
  assert.match(sql, /DROP POLICY IF EXISTS credit_notes_member_all/);
  assert.match(sql, /REVOKE ALL ON FUNCTION public.recalculate_credit_note_totals/);
  assert.match(atomic, /create_and_post_credit_note/);
  const customerApply = await read('supabase/migrations/20261001174000_customer_credit_application_v1.sql');
  const customerPermission = await read('supabase/migrations/20261001175000_customer_credit_permission_edge_v1.sql');
  const customerApplyModal = await read('app/next-workspace/customers/CustomerCreditApplyModal.tsx');
  const customerRefundModal = await read('app/next-workspace/customers/CustomerRefundModal.tsx');
  const customer360 = await read('app/next-workspace/customers/Customer360Controlled.tsx');
  assert.match(customerApply, /apply_customer_credit_to_invoice/);
  assert.match(customerApply, /customer-credit:/);
  assert.match(customerApply, /Target invoice must be posted/);
  assert.match(customerApply, /validate_journal_entry_balance/);
  assert.match(customerPermission, /payments\.receive/);
  assert.match(customerPermission, /customer_credit_balance/);
  assert.match(customerApplyModal, /apply_customer_credit_to_invoice/);
  assert.match(customerRefundModal, /refund_customer_credit/);
  assert.match(customer360, /CustomerRefundModal/);
  assert.match(customer360, /CustomerCreditApplyModal/);
  assert.match(modal, /create_and_post_credit_note/);
  assert.match(review, /CreditNoteModal/);
  assert.match(review, /canCreateCreditNote/);
  assert.match(review, /businessId/);
  assert.match(customerSecurity, /customer_credit_ledger_select/);
  assert.match(customerSecurity, /customer_refunds_select/);
  assert.match(customerSecurity, /account_subtype IN \('cash','bank'\)/);
  assert.match(sales360, /customer_credit_ledger/);
  assert.match(sales360, /customer_refunds/);
});

test('payment center exposes Payment 360 context', async () => {
  const payments = await read('app/next-workspace/payments/page.tsx');
  const panel = await read('app/next-workspace/documents/Transaction360Panel.tsx');
  assert.match(payments, /Transaction360Panel/);
  assert.match(payments, /entityType="payment"/);
  assert.match(payments, /setSelected360/);
  assert.match(panel, /entityType:[^;]*['"]payment['"]/);
  assert.match(panel, /Linked invoice/);
  assert.match(panel, /Linked purchase bill/);
  const payment360 = await read('supabase/migrations/20261001176000_transaction_360_payment_credit_v1.sql');
  const receipts = await read('app/next-workspace/receipts/page.tsx');
  assert.match(payment360, /supplier_credit_ledger/);
  assert.match(payment360, /customer_credit_ledger/);
  assert.match(payment360, /customer_refunds/);
  assert.match(receipts, /Transaction360Panel/);
  assert.match(receipts, /entityType="payment"/);
});

test('Core posted ledger tables are read-only to clients', async () => {
  const sql = await read('supabase/migrations/20261001187000_financial_ledger_table_readonly_boundary_v1.sql');
  for (const table of ['inventory_balances','inventory_movements','bank_transactions','credit_notes','credit_note_items','customer_credit_ledger','customer_refunds','vendor_credits','vendor_credit_items','vendor_credit_ledger','write_offs']) {
    assert.match(sql, new RegExp('REVOKE ALL ON TABLE public\\\\.' + table));
  }
  assert.match(sql, /FOR SELECT TO authenticated/);
  assert.doesNotMatch(sql, /member_all ON public\.(bank_transactions|inventory_balances|inventory_movements|write_offs)/);
});

test('Direct financial table writes are draft-only where legacy UI requires them', async () => {
  const sql = await read('supabase/migrations/20261001186000_draft_financial_write_state_boundary_v1.sql');
  assert.match(sql, /status = 'draft'::bill_status/);
  assert.match(sql, /journal_entry_id IS NULL/);
  assert.match(sql, /has_business_permission\(business_id,'purchases\.manage'\)/);
  assert.match(sql, /has_business_permission\(business_id,'expenses\.manage'\)/);
  assert.match(sql, /coalesce\(amount_paid,0\) = 0/);
});

test('financial table writes are permission-bound', async () => {
  const sql = await read('supabase/migrations/20261001185000_financial_table_write_permission_boundary_v1.sql');
  assert.match(sql, /REVOKE ALL ON TABLE public\.payment_allocations FROM anon, authenticated/);
  assert.match(sql, /GRANT SELECT ON TABLE public\.payment_allocations TO authenticated/);
  assert.match(sql, /has_business_permission\(business_id,'purchases\.manage'\)/);
  assert.match(sql, /has_business_permission\(business_id,'expenses\.manage'\)/);
  assert.match(sql, /GRANT SELECT ON TABLE public\.invoice_items TO authenticated/);
  assert.doesNotMatch(sql, /payment_allocations[^;]*FOR INSERT/);
});

test('Expense 360 is exposed from the Expenses workspace', async () => {
  const component = await read('app/next-workspace/documents/Transaction360Panel.tsx');
  const expenses = await read('app/next-workspace/expenses/ExpenseWorkspaceControlled.tsx');
  assert.match(component, /entityType:[^;]*['"]expense['"]/);
  assert.match(component, /entityType==='expense'\?'Supplier'/);
  assert.match(component, /entityType==='expense'\?'Expense'/);
  assert.match(expenses, /Transaction360Panel/);
  assert.match(expenses, /entityType="expense"/);
  assert.match(expenses, /setSelected360/);
});

test('Cash Bill supports anonymous walk-in customer identity', async () => {
  const sql = await read('supabase/migrations/20261001188000_cash_bill_walkin_customer_optional_v1.sql');
  const ui = await read('app/next-workspace/cash-bill/CashBillControlled.tsx');
  assert.match(sql, /nullif\(trim\(coalesce\(p_phone,''\)\),''\) IS NULL/);
  assert.match(sql, /get_or_create_cash_customer\(p_business_id\)/);
  assert.match(sql, /sales\.create/);
  assert.match(ui, /Customer mobile number \(optional\)/);
  assert.doesNotMatch(ui, /!p\.customerPhone\.trim\(\)/);
});

test('Cash Bill correction is authoritative and cannot swallow financial failures', async () => {
  const sql = await read('supabase/migrations/20261001184000_cash_bill_correction_hardening_v2.sql');
  assert.match(sql, /update_invoice_any_state/);
  assert.match(sql, /update_customer_payment/);
  assert.match(sql, /exactly one inbound settlement payment/);
  assert.match(sql, /Cash settlement requires an active Cash account/);
  assert.match(sql, /UPI settlement requires an active Bank account/);
  assert.match(sql, /assert_accounting_period_open/);
  assert.match(sql, /Cash Bill payment amount must equal the corrected document total/);
  assert.match(sql, /amount_paid <> final_invoice\.total/);
  assert.doesNotMatch(sql, /EXCEPTION WHEN OTHERS/);
});

test('supplier payment allocation lifecycle is atomic and multi-bill aware', async () => {
  const sql = await read('supabase/migrations/20261001178000_vendor_payment_allocation_lifecycle_v1.sql');
  const readPolicy = await read('supabase/migrations/20261001180000_vendor_payment_allocation_read_policy_v1.sql');
  const payment360 = await read('supabase/migrations/20261001179000_transaction_360_vendor_payment_allocations_v2.sql');
  const purchaseBill360 = await read('supabase/migrations/20261001182000_transaction_360_purchase_bill_multi_payment_v1.sql');
  const complete360 = await read('supabase/migrations/20261001183000_transaction_360_complete_relationships_v1.sql');
  const payments = await read('app/next-workspace/payments/page.tsx');
  const modal = await read('app/next-workspace/payments/VendorPaymentAllocationModal.tsx');
  const vendor360 = await read('app/next-workspace/vendors/Vendor360Controlled.tsx');

  assert.match(sql, /record_vendor_payment_unapplied/);
  assert.match(sql, /allocate_vendor_payment/);
  assert.match(sql, /Only posted supplier payments can be allocated or reallocated/);
  assert.match(sql, /crosses business or supplier boundary/);
  assert.match(sql, /Supplier payment currency does not match target purchase bill/);
  assert.match(sql, /Accounting adjustment permission required/);
  assert.match(sql, /idx_vendor_payment_allocations_payment/);
  assert.match(sql, /REVOKE ALL ON TABLE public.vendor_payment_allocations FROM anon, authenticated/);
  assert.match(readPolicy, /vendors\.manage/);
  assert.match(payment360, /'vendor_allocations'/);
  assert.match(payment360, /'bill_number'/);
  assert.match(purchaseBill360, /vendor_payment_allocations/);
  assert.match(purchaseBill360, /p\.bill_id=p_entity_id/);
  assert.match(complete360, /supplier_credits/);
  assert.match(complete360, /supplier_credit_ledger/);
  assert.match(complete360, /'corrections'/);
  assert.match(payments, /record_vendor_payment_unapplied/);
  assert.match(payments, /setAllocationPayment/);
  assert.match(payments, /Allocate/);
  assert.match(modal, /allocate_vendor_payment/);
  assert.match(modal, /Split or reassign/);
  assert.match(vendor360, /vendor_payment_allocations/);
  assert.match(vendor360, /Unapplied supplier advances/);
  assert.match(vendor360, /VendorPaymentAllocationModal/);
});

test('internal financial helper RPCs are not client-callable', async () => {
  const sql = await read('supabase/migrations/20261001181000_internal_financial_helper_security_boundary_v1.sql');
  const cashBillPage = await read('app/next-workspace/cash-bill/page.tsx');
  assert.match(sql, /REVOKE ALL ON FUNCTION public\.reverse_journal_entry/);
  assert.match(sql, /REVOKE ALL ON FUNCTION public\.post_journal_entry/);
  assert.match(sql, /REVOKE ALL ON FUNCTION public\.generate_receipt_for_payment/);
  assert.match(sql, /REVOKE ALL ON FUNCTION public\.get_or_create_cash_customer/);
  assert.match(cashBillPage, /rpc\('ensure_bank_account_ledger'/);
});

test('internal business seed functions are not client-callable', async () => {
  const sql = await read('supabase/migrations/20261001177000_internal_seed_security_boundary_v1.sql');
  assert.match(sql, /REVOKE ALL ON FUNCTION public\.seed_business_defaults/);
  assert.match(sql, /REVOKE ALL ON FUNCTION public\.seed_business_feature_flags_after_update/);
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
  const purchase360 = await read('supabase/migrations/20261001165000_transaction_360_supplier_credit_v1.sql');
  const sales360 = await read('supabase/migrations/20261001173000_transaction_360_sales_credit_v1.sql');
  const panel = await read('app/next-workspace/documents/Transaction360Panel.tsx');
  const review = await read('app/next-workspace/documents/DocumentReviewCenter.tsx');
  assert.match(sql, /get_transaction_360/);
  assert.match(sql, /source_quotation/);
  assert.match(sql, /inventory_movements/);
  assert.match(sql, /bank_transactions/);
  assert.match(purchase360, /supplier_credits/);
  assert.match(sales360, /credit_notes/);
  assert.match(panel, /get_transaction_360/);
  assert.match(panel, /purchase_bill/);
  assert.match(panel, /credit_notes/);
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
