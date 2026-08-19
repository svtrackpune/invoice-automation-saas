# Moneymatters — Wave-Inspired Product Parity Specification

## Scope

This specification converts the current Wave product model into an implementation target for Moneymatters. It is based on the supplied login screenshot plus Wave's currently published product documentation and feature pages. It is a behavioral/product benchmark, not a pixel-for-pixel copy of Wave branding or proprietary UI.

## Visual language

- Desktop-first two-level application shell with a persistent left navigation and a compact top bar.
- White content surfaces on a very light neutral canvas.
- One strong primary action color; secondary actions are quiet bordered controls.
- Dense but readable business tables; monetary figures use strong typographic hierarchy.
- Status is communicated with restrained semantic pills: paid/success, overdue/danger, draft/neutral, sent/primary.
- Cards use small radii, thin borders, and very soft elevation rather than heavy shadows.
- Forms should feel like business documents: clear labels, sensible defaults, inline validation, and a visible running total.
- Mobile collapses the left rail and keeps the primary create action accessible.
- Customer-facing documents need independent brand controls: logo, brand color, template, columns, payment terms, notes and footer.

## Global navigation model

### Business
1. Home / Dashboard
2. Sales & Payments
3. Estimates
4. Customers
5. Vendors
6. Products & Services
7. Purchases & Bills
8. Recurring

### Money & Accounting
9. Banking
10. Accounting
11. Tax & ITR
12. Reports

### Setup
13. Documents
14. Brand & Templates
15. Preferences
16. Data & Migration

Additional first-class operational destinations:
- Payments
- Receipts
- WhatsApp / WAPI
- Customer settings
- Inventory preferences

## Home / Dashboard behavior

The dashboard is an action cockpit, not an accounting textbook.

### Header
- Business switcher when the user has more than one business.
- Global search for customers, invoices and products.
- Create menu.
- Help and settings affordances.
- Responsive mobile navigation.

### Primary dashboard information
- Money in / sales value.
- Accounts receivable / amount to collect.
- Active customer count.
- Product/service count.
- Recent sales.
- Overdue invoice attention.
- Banking/reconciliation shortcut.
- Financial shortcuts: statements, P&L, trial balance.
- Cash-flow trend.
- Invoice status distribution.
- Recent activity.

### Dashboard rules
- Never show accounting jargon before the user needs it.
- Every metric must drill into the underlying records.
- Every overdue item must expose the next action.
- Empty states must provide the first useful action.

## Sales / Invoicing flow

1. Choose or create customer.
2. Enter invoice date and due date/payment terms.
3. Add products/services.
4. Edit quantity, rate, discount and tax per line.
5. Add notes/terms.
6. Review subtotal, discount, tax, total and balance due.
7. Choose document template/branding.
8. Save draft or send.
9. Optional online payment request.
10. Track viewed/sent/due/paid state.
11. Record offline/manual payment when required.
12. Receipt is created and the accounting entry is posted atomically.

The business workflow must remain connected to double-entry accounting so invoices and payments do not require duplicate bookkeeping.

## Estimates / quotation flow

1. Customer.
2. Items.
3. Pricing/tax/discount.
4. Deposit request if configured.
5. Review.
6. Send.
7. Track accepted/rejected/expired state.
8. Convert accepted estimate to invoice without retyping line items.

## Customer 360

Customer profile should expose:
- Contact information.
- Receivable balance.
- Invoice history.
- Payment history.
- Estimates.
- Statements.
- Recurring billing.
- Communication/reminder history.
- Notes.
- Customer-specific defaults.

## Payments

Support:
- Customer payment.
- Vendor payment.
- Payment method.
- Account/bank/cash destination.
- Amount.
- Date.
- Reference.
- Invoice allocation.
- Partial payment.
- Overpayment handling according to accounting policy.
- Receipt generation.
- Posting/reconciliation status.

The payment operation must be idempotent and must not create duplicate ledger entries on refresh/retry.

## Banking

Target behavior:
- Connect/import bank transactions.
- Display account balance and transaction feed.
- Match existing bookkeeping records.
- Categorize unmatched transactions.
- Split transaction where required.
- Mark reviewed.
- Reconcile/lock a period.
- Surface exceptions and unmatched items.

## Receipts / expenses

Target behavior:
- Capture receipt image/PDF.
- Extract merchant/date/amount/tax where possible.
- Associate customer/vendor/category.
- Post expense.
- Maintain source document.
- Search/filter/export.

## Recurring billing

Target behavior:
- Customer + template invoice.
- Frequency and start date.
- Optional end date.
- Automatic/manual billing mode.
- Automatic payment where configured.
- Reminder schedule.
- Pause/resume/cancel.
- Execution history.
- Failure/retry state.

## Products & services

Fields should cover:
- Name.
- SKU.
- Description.
- Sales price.
- Purchase price.
- Tax treatment.
- Unit.
- Active/inactive.
- Inventory tracking.
- Reorder/stock controls where inventory is enabled.

## Accounting

The accounting layer must remain a real double-entry system behind the business UI.

Required controls:
- Chart of accounts.
- Journal entries.
- General ledger.
- Trial balance.
- Accounts receivable.
- Accounts payable.
- Bank/cash accounts.
- Period reconciliation.
- Period lock.
- Audit trail.
- Source transaction linkage.

## Reporting

At minimum:
- Profit & Loss.
- Balance Sheet.
- Cash Flow.
- Trial Balance.
- General Ledger.
- A/R aging.
- A/P aging.
- Sales by customer.
- Sales by product/service.
- Tax summary.
- Period comparison.
- Export.

## Permissions and security

Every business-owned record is tenant-scoped by business/organization membership.

RLS requirements:
- Business membership must gate all business data.
- Customer/vendor/invoice/payment records must not leak between businesses.
- Sensitive AI/automation tables must have explicit RLS policies.
- Server-side posting functions must validate business ownership and authorization.
- Never expose service-role credentials to the browser.

## Moneymatters-specific extensions

These are intentionally beyond Wave parity:
- WhatsApp/WAPI notification center.
- Indian rupee formatting and India-oriented tax/ITR workflows.
- GST-ready document structure.
- Business-specific automation.
- Data migration/import validation.
- Stronger operational reconciliation.

## Test acceptance criteria

A release is ready for manual testing only when these paths work end-to-end:

1. Create customer → create product → create estimate → accept → convert to invoice.
2. Create invoice → send/save → record partial payment → receipt → remaining balance.
3. Record full payment → invoice becomes paid → accounting posting exists once.
4. Create vendor → record bill/purchase → record payment → payable reduces correctly.
5. Import/review bank transaction → match/categorize → reconcile.
6. Create recurring invoice → execute once → verify next run state.
7. Open customer 360 → verify invoices, payments and balance agree.
8. Run P&L and Balance Sheet → verify ledger totals reconcile.
9. Switch businesses → verify every list and metric changes tenant context.
10. Attempt unauthorized cross-business access → must be denied by RLS/server authorization.
11. Use mobile viewport → navigation, create action, forms and tables remain usable.
12. Refresh after every mutation → no duplicate records or duplicate accounting postings.
