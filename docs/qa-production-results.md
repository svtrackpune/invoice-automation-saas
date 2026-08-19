# Production QA — 12 Core Scenarios

Tested against the production Supabase/accounting stack for business `vishnu` using transaction-scoped QA data and rollback. No test records were retained.

| Scenario | Result | Notes |
|---|---|---|
| S01 Customer → Product → Estimate → Invoice | PASS | Found and fixed quotation document numbering and quotation→invoice argument mismatch. |
| S02 Invoice → Partial Payment → Receipt | PASS | Invoice balance and receipt flow verified with 400/600 split. |
| S03 Invoice → Full Payment → Accounting | PASS | Invoice posting and payment journals balance debit=credit. |
| S04 Vendor → Bill → Payment | PASS | Fixed journal numbering, vendor payment permission mismatch, and bill payment balance update. |
| S05 Bank Transaction → Match → Reconcile | PASS | Fixed reconciliation permission/schema/date ordering; categorization now creates a balanced journal and locking succeeds. |
| S06 Recurring Billing | PASS | Run preparation/execution creates the invoice and advances the schedule. |
| S07 Customer 360 | PASS | Business-scoped customer summary/statement views reviewed; joins include tenant context. |
| S08 Financial Reports | PASS | Fixed enum/text filtering in P&L and Balance Sheet; Trial Balance executes. |
| S09 Tenant Isolation | PASS | Cross-business dashboard RPC rejects unauthorized business IDs; remaining table RLS gaps were hardened. |
| S10 Mobile UX | REVIEW | Responsive navigation/layout is implemented in the Next workspace; final human device pass is still required. |
| S11 Refresh / Idempotency | PASS | Gateway transaction IDs are now unique per business; duplicate payment submission returns the existing receipt. |
| S12 Documents & Branding | PASS | Template initialization, active-template selection, branding colors and export schema verified. |

## Production fixes applied

- Business-scoped journal entry numbering hardened with transaction advisory locks.
- Quotation document numbers supported.
- Quotation-to-invoice conversion corrected.
- Bill/expense journal posting corrected for journal numbering.
- Vendor payment authorization aligned with `payments.pay`.
- Vendor bill payment balances now update against the correct bill allocation.
- Bank reconciliation authorization aligned with existing owner permissions.
- Bank transaction ordering corrected to use `imported_at`.
- Bank expense/manual categorization now creates a balanced accounting journal.
- Reconciliation lock requires zero difference and no unreconciled transactions.
- Customer payment gateway idempotency added with a unique business/gateway transaction constraint.
- Remaining public tables without RLS were hardened.
- Security-definer RPCs were restricted from `public`/`anon`; authenticated access remains for application RPCs.
- Document preference initialization now chooses an active modern template or active fallback.

## Deployment note

The production Supabase database contains the applied hardening migrations. The GitHub `main` branch contains the corresponding application-side Banking workflow changes. The existing GitHub build workflow is configured for `main`, but no workflow run was observable through the connected GitHub integration after the latest push, so the Plesk `npm run build` remains the deployment-side build gate.
