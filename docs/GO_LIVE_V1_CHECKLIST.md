# Moneymatters v1 — Go-Live Acceptance Checklist

This is the single release acceptance checklist for the core application. Add-on AI and advanced integrations are intentionally outside v1 acceptance.

## 1. Business & tenancy
- [ ] Create/select business
- [ ] Switch businesses without data leakage
- [ ] Business preferences persist
- [ ] GST/non-GST mode changes applicable UI only
- [ ] Currency/number/date settings are respected

## 2. Customers / Customer 360
- [ ] Create/edit customer
- [ ] Search/filter customer
- [ ] View 360 financial summary
- [ ] View invoices, quotations, payments, receipts, credits
- [ ] Generate customer statement
- [ ] Record payment from customer context
- [ ] Reminder preferences work

## 3. Products & inventory
- [ ] Create product/service
- [ ] Sales/purchase prices
- [ ] Discount rules and limits
- [ ] Tax configuration when applicable
- [ ] Stock opening balance
- [ ] Purchase/sale/return/adjustment movements
- [ ] Available stock is correct
- [ ] Inventory accounting agrees with GL

## 4. Quotations
- [ ] Create draft quotation
- [ ] Edit/send quotation
- [ ] Accept/reject lifecycle
- [ ] Convert accepted quotation to invoice
- [ ] No duplicate invoice on repeat conversion
- [ ] Customer balance remains unchanged until invoice posting

## 5. Sales invoices / AR
- [ ] Create draft invoice
- [ ] Calculate subtotal/discount/tax/total correctly
- [ ] Post invoice once only
- [ ] Journal balances exactly
- [ ] AR increases correctly
- [ ] Revenue/tax accounts update correctly
- [ ] Send/preview/PDF works
- [ ] Due date and ageing are correct

## 6. Payments / receipts
- [ ] Full payment
- [ ] Partial payment
- [ ] Multiple payments against invoice
- [ ] Overpayment handling
- [ ] Payment cannot exceed permitted balance without explicit overpayment flow
- [ ] Payment posts bank/cash and reduces AR
- [ ] Receipt generated
- [ ] Invoice/payment status updates correctly

## 7. Credit notes / sales returns
- [ ] Create credit note
- [ ] Apply against invoice/customer balance
- [ ] Sales return reverses inventory when applicable
- [ ] Tax reversal is correct
- [ ] GL remains balanced
- [ ] Refund path is distinct from credit application

## 8. Purchases / AP / vendor returns
- [ ] Create vendor/bill/purchase
- [ ] AP posting correct
- [ ] Inventory receipt correct
- [ ] Vendor payment reduces AP
- [ ] Debit note/purchase return reverses applicable inventory/tax/AP
- [ ] Vendor balance and GL agree

## 9. Banking / reconciliation
- [ ] Bank/cash accounts available
- [ ] Import transactions
- [ ] Match existing transaction
- [ ] Categorize unmatched transaction
- [ ] Split transaction where supported
- [ ] Transfers do not create artificial income/expense
- [ ] Reconciliation difference reaches zero
- [ ] Reconciled period cannot be silently altered

## 10. Accounting controls
- [ ] Every posted journal balances
- [ ] Journal lines are not directly mutable as history
- [ ] Adjustments use controlled entries
- [ ] Reversals preserve audit history
- [ ] Period close blocks prohibited postings
- [ ] Reopen requires explicit controlled action
- [ ] Audit trail identifies actor/time/action/source

## 11. Reports / year end / tax
- [ ] Trial balance balances
- [ ] P&L agrees with ledger
- [ ] Balance sheet balances
- [ ] AR ageing agrees with customer subledger
- [ ] AP ageing agrees with vendor subledger
- [ ] Inventory valuation agrees with inventory ledger
- [ ] Tax reports agree with tax postings
- [ ] TDS/TCS data exports where applicable
- [ ] Year-end retained earnings/closing logic is correct
- [ ] CA-ready ledger export works

## 12. Documents / notifications
- [ ] Invoice PDF
- [ ] Quotation PDF
- [ ] Receipt PDF
- [ ] Credit note PDF
- [ ] Business branding/templates
- [ ] WAPI connection per business
- [ ] Approved WhatsApp template selection
- [ ] Notification queue records status/retry/error
- [ ] Payment link is present only when configured

## 13. Data migration
- [ ] Import validation catches malformed records
- [ ] Preview before commit
- [ ] Import is business-scoped
- [ ] Duplicate handling is deterministic
- [ ] Errors are downloadable/reviewable
- [ ] Export includes required business data
- [ ] Export/import round-trip preserves financial meaning

## 14. Security / production
- [ ] Environment variables configured
- [ ] No service-role secrets exposed to browser
- [ ] RLS/business isolation verified
- [ ] Unauthorized business access denied
- [ ] Error messages do not expose secrets
- [ ] Production build succeeds
- [ ] Database migrations applied in order
- [ ] Backup/recovery plan confirmed

## Release rule

Do not call v1 production-ready merely because the UI loads or the build succeeds. The application is ready only when the critical workflows above have been executed against the deployed environment and financial balances reconcile end-to-end.
