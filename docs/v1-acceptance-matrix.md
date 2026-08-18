# Moneymatters V1 Acceptance Matrix

A feature is not considered complete because a screen opens. It is complete only when the UI action, database mutation, accounting effect, inventory effect (if applicable), audit event, permissions and downstream reports all agree.

## Authentication & business

- [ ] Sign up creates auth user and profile
- [ ] Email confirmation works for production mode
- [ ] Sign in/out and session refresh work
- [ ] Business registration creates exactly one isolated business context
- [ ] User can switch between businesses without cross-business data leakage
- [ ] Business logo is stored per business
- [ ] Branding is stored per business

## Customers

- [ ] Create/edit/archive customer
- [ ] Customer search is fast on mobile
- [ ] Customer 360 shows invoices, payments, dues, reminders and timeline
- [ ] Customer balance equals posted ledger balance
- [ ] Customer cannot access another business's records

## Products & inventory

- [ ] Create product/service
- [ ] SKU, HSN/SAC, unit, sale price, purchase price and tax are persisted
- [ ] Inventory tracking can be enabled/disabled per item
- [ ] Opening stock works
- [ ] Sale reduces stock
- [ ] Purchase increases stock
- [ ] Adjustment creates movement and audit record
- [ ] Low-stock threshold creates actionable alert
- [ ] No stock mutation occurs for draft transactions

## Quotation

- [ ] Create quotation
- [ ] Optional item/global discount
- [ ] Tax calculation
- [ ] Validity and terms
- [ ] Five templates
- [ ] Business logo and color preset
- [ ] Preview/print/PDF
- [ ] Send/share action
- [ ] Status lifecycle: Draft → Sent → Accepted/Rejected/Expired
- [ ] Accepted quotation can convert to invoice without re-entry

## Invoice

- [ ] Automatic numbering
- [ ] Customer/product selection
- [ ] Item quantity and price
- [ ] Item/global discount
- [ ] CGST/SGST/IGST logic
- [ ] Due date/payment terms
- [ ] Five templates
- [ ] Business branding
- [ ] Draft does not post accounting
- [ ] Post creates correct journal entries
- [ ] Post updates inventory where applicable
- [ ] Partial payment works
- [ ] Full payment works
- [ ] Overpayment is blocked or explicitly handled
- [ ] Void reverses financial impact correctly

## Receipt & payments

- [ ] Payment can be recorded against invoice
- [ ] Partial payment updates balance due
- [ ] Receipt generated automatically
- [ ] Five receipt templates
- [ ] Receipt carries business branding
- [ ] Cash/bank account updated
- [ ] Customer ledger updated
- [ ] Duplicate payment protection

## Purchases

- [ ] Vendor master
- [ ] Purchase order
- [ ] Goods receipt
- [ ] Vendor bill
- [ ] Purchase approval
- [ ] Inventory increase after posted purchase
- [ ] Payable created
- [ ] Vendor payment settles payable
- [ ] Purchase/receipt mismatch is visible

## Expenses

- [ ] Expense categories
- [ ] Expense account selection
- [ ] Receipt attachment
- [ ] Recurring expense option
- [ ] Approval option
- [ ] Posting updates expense and cash/bank

## Banking

- [ ] Bank account setup
- [ ] Statement import/transaction feed
- [ ] Suggested match
- [ ] Manual match
- [ ] Categorization
- [ ] Reconciliation
- [ ] Unmatched transaction exception

## Accounting & reports

- [ ] General ledger
- [ ] Trial balance
- [ ] Profit & loss
- [ ] Balance sheet
- [ ] Receivable ageing
- [ ] Payable ageing
- [ ] Cash flow
- [ ] Tax/GST summaries
- [ ] Reports reconcile to posted journal entries
- [ ] Draft transactions do not appear in posted financial reports

## Permissions & audit

- [ ] Owner
- [ ] Admin
- [ ] Accountant
- [ ] Staff
- [ ] Viewer
- [ ] Sensitive actions respect permissions
- [ ] Approval rules enforced server-side
- [ ] Financial mutations have audit entries
- [ ] No client-only authorization decisions

## Mobile/low-network

- [ ] Login works on phone
- [ ] Navigation remains usable at 360px width
- [ ] Create invoice requires minimal taps
- [ ] Forms avoid unnecessary network calls
- [ ] Cached reference data can be used where supported
- [ ] Offline queue prevents duplicate posting
- [ ] Sync status is visible
- [ ] Conflicts are explicit and recoverable

## Release gate

A release is accepted only when all P0 checks pass and there are no known P0/P1 financial correctness or data-isolation defects.
