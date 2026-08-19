# Moneymatters v1 — Core User Flows

## Home
Home answers three questions first: what needs attention, what money is coming in/out, and what should I do next.

Primary actions: Invoice, Estimate, Payment, Expense.

## Money In
Estimate → accepted → invoice → sent → payment → receipt → customer statement.

Accounting is automatic. Users do not need to manually create journal entries for normal sales activity.

## Money Out
Expense or Bill/Purchase → payment → accounting → vendor balance. Stock-tracked purchases also update inventory.

## Customer 360
Customer profile is the financial relationship: balance, overdue, invoices, estimates, payments, receipts, credits, statements, recurring billing and communication history.

## Product / Service
Product and service configuration controls price, purchase cost, discount policy, tax treatment and optional stock tracking. Inventory movements must remain connected to accounting where inventory accounting is enabled.

## Banking
Imported bank activity is matched or categorized. Matching an existing business transaction must not create a second accounting event. Transfers affect the correct cash/bank accounts without becoming income or expense.

## Accounting
Normal business workflows create controlled accounting postings. Manual journals and adjustments are accountant-facing tools. Posted history is not edited in place; corrections use controlled adjustments/reversals.

## Documents
Invoice, quotation, receipt and credit-note documents use the business template/branding configuration. Sending is separate from posting, and delivery/notification status is recorded.

## WhatsApp
Each business can connect its own WAPI instance, select approved templates, enqueue notifications and see delivery/error/retry state. No global business data is mixed across WAPI connections.

## Migration
Import is validate → preview → commit. Export is business-scoped and designed for CA/accountant use. Financial records must never be partially committed because one row failed validation.

## v1 boundary
AI advertising, advanced AI analysis, advanced third-party integrations and other addon capabilities are intentionally deferred until the core financial application is proven stable.
