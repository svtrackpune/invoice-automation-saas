# Moneymatters flexible controls

The workspace intentionally makes tax, reminders, discounts and document presentation configurable rather than mandatory.

## User choices
- Business tax mode: Smart / GST / Non-GST
- Business default payment reminders on/off and lead time
- Customer-level payment reminders on/off and lead time
- Customer default discount: none / percent / amount
- Product-level discount allowed on/off
- Product discount suggested maximum: percent or amount
- Invoice, quotation and receipt template selection

Routes:
- `/next-workspace/preferences` — business preferences and document templates
- `/next-workspace/customer-settings` — customer-level reminders and discount defaults
- `/next-workspace/inventory-preferences` — product-level discount controls

Defaults are suggestions. Transaction screens should allow overrides with approval controls where the business chooses to enforce limits.
