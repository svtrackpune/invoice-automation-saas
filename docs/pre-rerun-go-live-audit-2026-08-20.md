# Pre-rerun Go-Live Audit — 2026-08-20

## Scope

Before rerunning the complete v1 acceptance matrix, the live Supabase project and `main` branch were reviewed for authentication, tenant isolation, RLS, RPC privileges, accounting mutation controls, business settings, database-advisor findings, and existing production QA results.

## Findings fixed before rerun

1. **Permission-helper RLS recursion** — `mm_private.has_permission` and `mm_private.has_business_permission` are now `SECURITY DEFINER` helpers with an explicit search path, preventing recursive `organization_members` RLS evaluation.
2. **Anonymous RPC mutation surface** — anonymous execution was removed from journal mutation, document-number generation, chart seeding, and internal trigger/cron helpers.
3. **Direct journal authorization** — posting requires `accounting.post`; reversal requires `accounting.adjust`, checks the accounting period, and uses an advisory lock for journal numbering.
4. **Journal history RLS** — members retain read access; journal inserts require posting permission; journal updates/deletes require adjustment permission; journal-line mutations inherit the parent journal permission.
5. **Business/settings authorization** — business identity and business settings writes require `settings.manage`; affected preference/tax/AI policies are authenticated-only.
6. **Report-view isolation** — live accounting/subledger/report views were changed to `security_invoker=true` so underlying RLS applies to the caller.
7. **Function search-path hardening** — affected trigger/pure helper functions now have deterministic search paths.
8. **Internal helper exposure** — trigger, cron and internal recalculation helpers were removed from the authenticated API execution surface.
9. **Database cleanup** — duplicate indexes reported by Performance Advisor were removed.

## Live verification performed

- All public tables currently have RLS enabled.
- No `public`-role RLS policies remain in the public schema.
- Anonymous execution of `next_document_number` was rejected with `permission denied for function next_document_number`.
- A non-member UUID returns `false` for both `settings.manage` and `accounting.post` permission checks.
- Owner business-settings update was tested inside a rolled-back transaction and was authorized.
- Report/subledger views can be queried under an authenticated transaction with RLS enforced.
- Supabase Security Advisor now has **no ERROR-level security finding**. Remaining WARNs are primarily intentional authenticated `SECURITY DEFINER` application RPCs plus the separate Auth leaked-password-protection setting.
- Performance Advisor's duplicate-index findings were addressed; remaining unindexed-FK and RLS-initplan findings are optimization items rather than data-integrity blockers.
- Existing production PostgreSQL logs show the invoice-reminder cron completing successfully.

## Important remaining production item

**Leaked password protection is disabled in Supabase Auth.** This is an Auth/dashboard configuration rather than a database migration. It should be enabled before public launch.

## Existing production QA baseline

The previous production QA covered 12 core scenarios: customer→invoice, partial/full payments, vendor bills/payments, banking/reconciliation, recurring billing, Customer 360, reports, tenant isolation, mobile UX review, idempotency, and documents/branding. Eleven were marked PASS and mobile UX remained REVIEW pending a final human device pass.

This audit does **not** mark the application production-ready by itself. The complete UI/API/accounting acceptance matrix must still be rerun against the deployed application, with financial balances reconciled end-to-end.

## Release gate after this audit

1. Enable leaked-password protection in Supabase Auth.
2. Deploy/verify the `main` branch containing the hardening migrations.
3. Run the full v1 acceptance matrix, not only the previous 12 scenarios.
4. Test owner/admin/accountant/staff/viewer permission boundaries.
5. Test cross-business reads and writes.
6. Reconcile invoice/payment/vendor/bank/inventory/report balances.
7. Complete the mobile/device pass.
8. Record the final production build result and any remaining P0/P1 issues.
