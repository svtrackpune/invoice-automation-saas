# Moneymatters implementation progress

## Current milestone
Customer 360 and customer statement UX are the next implementation layer after recurring billing.

## Product rules
- Customer balances are business-scoped.
- Statements must distinguish invoices/debits, payments/credits and running balance.
- Customer 360 should expose invoices, payments, receipts, quotations, statement and communication history.
- Quick actions should remain available from the customer context.
- GST terminology must remain business-specific and should not leak into non-GST workflows.

## Deployment contract
Code changes are prepared in GitHub. The owner will pull `main`, deploy through Plesk, run `npm run build`, and return build/runtime results before the next production-like test cycle.
