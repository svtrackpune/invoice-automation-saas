# Pre-rerun Go-Live Audit — 2026-08-20

## Scope

Before rerunning the complete v1 acceptance matrix, the live Supabase project and `main` branch were reviewed for authentication, tenant isolation, RLS, RPC privileges, accounting mutation controls, business settings, master-data CRUD, database-advisor findings, and existing production QA results.

## Master-data CRUD implemented

The following production flows are now explicitly supported:

- **Customers:** create/add, list/search, full profile modification, safe delete/deactivate, and restore of inactive records.
- **Vendors:** create/add, list/search, full profile modification, safe delete/deactivate, and restore of inactive records.
- **Products:** create/add, list/search/filter, full modification, safe delete/deactivate, and restore.
- **Services:** create/add, list/search/filter, full modification, safe delete/deactivate, and restore through the same `products_services` master using `item_type = service`.

Deletes are intentionally implemented as deactivation (`is_active=false`) rather than physical deletion so invoices, bills, payments, stock history, and reports retain their historical references.

## CRUD authorization hardening

Master-data RLS was tightened so authenticated business members can read records, while mutations require the matching management permission:

- Customers: `customers.manage`
- Vendors: `vendors.manage`
- Products/services: `inventory.manage`
- Product/service reads additionally require `inventory.view` or `inventory.manage`.

UPDATE policies include both `USING` and `WITH CHECK`, preventing cross-business reassignment. No anonymous/public CRUD policy exists for these masters.

## Previous findings fixed before rerun

1. **Permission-helper RLS recursion** — `mm_private.has_permission` and `mm_private.has_business_permission` are now SECURITY DEFINER helpers with an explicit search path, preventing recursive `organization_members` RLS evaluation.
2. **Anonymous RPC mutation surface** — anonymous execution was removed from journal mutation, document-number generation, chart seeding, and internal trigger/cron helpers.
3. **Direct journal authorization** — posting requires `accounting.post`; reversal requires `accounting.adjust`, checks the accounting period, and uses an advisory lock for journal numbering.
4. **Journal history RLS** — members retain read access; journal inserts require posting permission; journal updates/deletes require adjustment permission; journal-line mutations inherit the parent journal permission.
5. **Business/settings authorization** — business identity and business settings writes require `settings.manage`; affected preference/tax/AI policies are authenticated-only.
6. **Report-view isolation** — accounting/subledger/report views use `security_invoker=true` so underlying RLS applies to the caller.
7. **Function search-path hardening** — affected trigger/pure helper functions have deterministic search paths.
8. **Internal helper exposure** — trigger, cron and internal recalculation helpers were removed from the authenticated API execution surface.
9. **Database cleanup** — duplicate indexes reported by Performance Advisor were removed.

## Live verification performed

- All public tables currently have RLS enabled.
- No `public`-role RLS policies remain in the public schema.
- Anonymous execution of `next_document_number` was rejected with `permission denied for function next_document_number`.
- A non-member UUID returns `false` for `customers.manage`, `vendors.manage`, and `inventory.manage`.
- Master-data tables now expose SELECT policies to authenticated business members and separate permission-gated INSERT/UPDATE/DELETE policies.
- UPDATE policies contain both row visibility and write checks.
- Existing production PostgreSQL logs show the invoice-reminder cron completing successfully.
- Supabase Security Advisor has no ERROR-level security finding. Remaining WARNs are primarily intentional authenticated SECURITY DEFINER application RPCs plus the separate Auth leaked-password-protection setting.

## Important remaining production item

**Leaked password protection is disabled in Supabase Auth.** This is an Auth/dashboard configuration rather than a database migration. It should be enabled before public launch.

## Existing production QA baseline

The previous production QA covered 12 core scenarios: customer→invoice, partial/full payments, vendor bills/payments, banking/reconciliation, recurring billing, Customer 360, reports, tenant isolation, mobile UX review, idempotency, and documents/branding. Eleven were marked PASS and mobile UX remained REVIEW pending a final human device pass.

This audit does **not** mark the application production-ready by itself. The complete UI/API/accounting acceptance matrix must still be rerun against the deployed application, with financial balances reconciled end-to-end.

## Release gate after this audit

1. Enable leaked-password protection in Supabase Auth.
2. Deploy/verify the `main` branch containing the hardening migrations and master-data CRUD changes.
3. Rerun customer CRUD: create → read/search → modify → deactivate → restore.
4. Rerun vendor CRUD: create → read/search → modify → deactivate → restore.
5. Rerun product CRUD: create → read/search → modify → deactivate → restore.
6. Rerun service CRUD: create → read/search → modify → deactivate → restore.
7. Verify role boundaries for owner/admin/accountant/staff/viewer.
8. Test cross-business reads and writes.
9. Reconcile invoice/payment/vendor/bank/inventory/report balances.
10. Complete the mobile/device pass.
11. Record the final production build result and any remaining P0/P1 issues.
