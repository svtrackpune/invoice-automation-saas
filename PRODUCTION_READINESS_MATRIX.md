# Moneymatters Production Readiness Matrix

Branch: `production-hardening-2026-10`
Base: `main` at `55ef7cc3b363e7f7513ff04364bbc8e86880c14a`

## Completed or materially hardened in this production cycle

| Area | State | Evidence / acceptance condition |
|---|---|---|
| First-class sales document type | Implemented | `invoices.document_kind` supports `invoice` and `cash_bill`; legacy Cash & Carry records are backfilled |
| Cash Bill atomic creation | Implemented | UI calls `create_cash_bill`; DB function creates invoice, posts it, and records the payment in one transaction |
| Cash Bill correction | Implemented | `update_cash_bill_any_state` corrects bill and settlement together and requires final balance zero |
| Cash Bill popup | Implemented | Document review passes `cash_bill=1`; iframe correction reports completion to parent without navigating away |
| Invoice correction | Existing + retained | `update_invoice_any_state` remains the correction engine for ordinary invoices |
| Payment correction | Implemented | `update_customer_payment` preserves payment identity, allocation identity and receipt identity; journal is synchronized |
| Payment over-allocation guard | Implemented | Correction allocation is calculated against other allocations on the same invoice |
| Paid-invoice void guard | Implemented | Database trigger rejects voiding any invoice with a positive payment allocation |
| Closed-period protection | Retained | Correction/payment RPCs call `assert_accounting_period_open` |
| Journal balance protection | Retained | Correction/payment RPCs call `validate_journal_entry_balance` |
| Cash Bill settlement method | Implemented | Cash/UPI only, with Cash/Bank ledger validation |
| Cash Bill document navigation | Implemented | Invoice list shows Cash Bill badge and correct action label |
| Purchase bill correction | Implemented | Existing bill ID/number preserved; posted journal is reversed and corrected accounting/inventory is reposted |
| Supplier payment correction | Implemented | Existing payment identity is preserved; AP balance, journal and vendor credit are synchronized |
| Supplier 360 | Implemented | Vendor master links to Supplier 360 with bills, payments, balances and statement views |
| Expense correction | Implemented | Existing expense ID is preserved; posted journal is reversed and corrected expense accounting is reposted |
| Paid purchase-bill void guard | Implemented | Database trigger blocks voiding a purchase bill with positive supplier-payment allocation |
| Supplier credit lifecycle | Implemented | Posted supplier credits validate source-line quantities, reverse stock/AP/tax atomically, and auto-apply to the source bill when balance remains |
| Supplier credit refund | Implemented | Available supplier credit can be received through Cash/Bank with period, permission and journal-balance checks |
| Supplier credit settlement safety | Implemented | Bill balance is recalculated from payment allocations plus vendor-credit applications; payment allocations are blocked from net over-settlement |
| Supplier credit tenancy boundary | Implemented | Vendor-credit tables are read-only to authenticated clients; writes flow through SECURITY DEFINER RPCs with explicit permissions |
| Sales credit-note lifecycle | Implemented | Regular posted invoices expose source-line credit-note creation; server derives source amounts, enforces quantity/balance limits, and posts atomically |
| Customer credit/refund security | Implemented | Customer credit/refund ledgers are read-only to clients; refund RPC enforces customer ownership, accounting period and Cash/Bank account |
| Invoice 360 credit trail | Implemented | Invoice 360 now includes credit notes, customer-credit ledger entries and customer refunds |
| Payment search | Implemented | Global search searches payment method/reference/amount |
| Payment 360 | Implemented | Payments and Receipts centers open the canonical Payment 360 relationship view |
| CI financial gate | Implemented | Production readiness now runs `test:financial` |
| CI correction contract gate | Implemented | Production readiness runs `tests/correction-contract.test.mjs` |
| Core financial audit coverage | Implemented | Audit triggers cover invoices, lines, bills, lines, expenses, receipts, quotations and lines |
| Quotation audit coverage | Implemented | Draft/sent quotation corrections and lifecycle changes are recorded in the financial audit trail |
| Read-only final quality workflow | Implemented | The previous auto-commit/auto-push quality workflow was replaced with deterministic verification |

## Existing capabilities verified during audit

Quotation conversion, customer editing, product/service management, inventory-aware invoice posting, bank/cash settlement accounts, document viewing, global search, accounting periods, bank reconciliation infrastructure, recurring workflows, CA export infrastructure, GST/non-GST tax profile infrastructure, and public quotation/invoice sharing already exist in the repository.

## Remaining production-hardening work

These items are not marked complete until code and tests demonstrate the acceptance criteria.

### Transaction lifecycle integration
- Canonical lifecycle service/RPC layer across every transaction type is still being consolidated; the current branch now provides dedicated correction RPCs plus a canonical read-side Transaction 360 model.
- Consistent View / Edit / Duplicate / Void / Pay / Receipt / Link actions across every transaction type still need a full route-by-route pass.
- Bidirectional transaction graph is materially surfaced for invoice/Cash Bill/quotation and supplier-side flows; remaining modules still need the same relationship depth.

### Purchasing and expenses
- Multi-bill/unapplied supplier payment allocation and reallocation remains on the controlled roadmap; supplier-credit application to another posted bill is implemented.
- Purchase inventory correction replay across downstream inventory activity remains restricted when current stock cannot absorb the original movement reversal.
- Supplier payment correction for multi-bill/unapplied payments remains on the controlled credit/reallocation roadmap; vendor-credit application is handled separately.
- Purchase bill popup correction experience is implemented.

### Quotations
- Quotation edit/correction lifecycle with explicit draft/sent/accepted/rejected/cancelled states is implemented for the current workflow.
- Conversion creates an independent invoice record from quotation items; full regression coverage is still required to sign off historical independence under all edge cases.
- Quotation correction popup is implemented for draft/sent estimates.

### Inventory/accounting
- Full correction test matrix for quantity, rate, discount, GST, location, batch and serial changes.
- Reconciliation tests for COGS, stock, receivables, revenue and tax after every supported correction.
- Negative and concurrency cases, including simultaneous edits and duplicate posting attempts.

### 360-degree relationship views
- Customer 360: quotes, invoices/Cash Bills, payments, receipts, credits/refunds, balance and aging; credit/refund history is now surfaced.
- Supplier 360: bills, payments, credits/refunds and balance.
- Invoice 360: source quotation, items, payment allocation, receipt, credit notes/customer credits/refunds, journal, inventory movement, bank transaction and corrections.
- Purchase Bill 360: supplier, payments, journal, inventory movement and bank links are now surfaced on the purchase detail page.
- Payment 360: invoice/bill allocation, receipt, journal, bank transaction, credit/refund history.

### Reporting
- Automated reconciliation checks between subledgers, journals, inventory and bank balances.
- CA-ready GST/income-tax report verification against transactional data.
- Query-driven filters for customer/supplier/date/document/tax/payment dimensions.

### Security and tenancy
- Systematic cross-business negative tests for all new and high-value RPCs.
- Review of all existing exposed SECURITY DEFINER functions; reduce grants where public execution is not intentional.
- RLS policy coverage and automated member/non-member tests for critical business tables.
- Audit trail coverage for every correction, void, payment change and master-data change.

### UX
- One consistent correction modal/panel pattern for every major transaction type.
- No forced navigation away from the transaction context for correction.
- Clear status semantics kept separate: document kind, tax treatment, payment state and settlement method.
- Customer-specific tax/payment/defaults remain suggestions with transaction-level override.

### Test coverage
Target the full matrix before production sign-off:
- Draft / posted / partially paid / paid / overdue / void
- GST / non-GST
- Cash / UPI / bank / card / cheque / gateway / other where supported
- Product / service / mixed invoice
- Discount and tax changes
- Inventory and non-inventory
- Cash Bill
- Multiple payments
- Overpayment / customer credit
- Closed period
- Permission denial
- Cross-business access denial
- Concurrent correction/posting

## Production sign-off rule

A feature is complete only when:
1. the UI path exists;
2. the database transaction is atomic where financial state changes;
3. the operation respects permissions and accounting periods;
4. linked journal/inventory/payment/receipt state remains consistent;
5. regression tests cover success and failure paths;
6. CI passes on the same branch/commit;
7. no production data is used as a test fixture in a destructive way.

This document deliberately distinguishes implemented work from audited-but-unfinished work; it is not a claim that every future hardening item is complete.
