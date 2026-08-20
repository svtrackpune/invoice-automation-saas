# Pre-rerun Go-Live Audit — 2026-08-20

## Scope

Before rerunning the complete v1 acceptance matrix, the live Supabase project and `main` branch were reviewed for authentication, tenant isolation, RLS, RPC privileges, accounting mutation controls, business settings, and existing production QA results.

## Findings fixed before rerun

1. **Permission-helper RLS recursion**
   - `mm_private.has_permission` and `mm_private.has_business_permission` were security-invoker helpers while policies depended on them, creating a potential `organization_members` RLS recursion path.
   - Both helpers are now `SECURITY DEFINER` with an explicit `search_path` and are callable only by `authenticated`.

2. **Anonymous RPC mutation surface**
   - Anonymous execution was removed from journal creation/posting/reversal, chart seeding, document-number generation, and trigger-only helper functions.
   - The only remaining public/anonymous public-schema RPC is the pure `calculate_invoice_discount` helper.

3. **Direct journal posting authorization**
   - `post_journal_entry` now derives the business from the entry and requires `accounting.post`.
   - `reverse_journal_entry` now requires `accounting.adjust`, checks the accounting period, and uses an advisory lock for journal numbering.

4. **Journal history RLS**
   - Members retain read access to their own business journal history.
   - Journal insert requires `accounting.post`.
   - Journal update/delete requires `accounting.adjust`.
   - Journal-line mutations inherit the parent journal business permission.

5. **Business/settings authorization**
   - Business identity updates now require `settings.manage`.
   - Business settings writes now require `settings.manage`; member read access remains available.
   - Document preferences, business preferences, tax profiles, AI agent settings, tax adjustments and tax filing profiles no longer use `public`-role policies and are explicitly scoped to authenticated users/permissions.

## Live verification performed

- All public tables currently have RLS enabled.
- No `public`-role RLS policies remain in the public schema.
- Anonymous execution of `next_document_number` was rejected with `permission denied for function next_document_number`.
- A non-member UUID returns `false` for both `settings.manage` and `accounting.post` permission checks.
- Owner business-settings update was tested inside a rolled-back transaction and was authorized.
- Existing production PostgreSQL logs show the invoice-reminder cron completing successfully; no new database error was introduced by the hardening migration.

## Existing production QA baseline

The previous production QA covered 12 core scenarios: customer→invoice, partial/full payments, vendor bills/payments, banking/reconciliation, recurring billing, Customer 360, reports, tenant isolation, mobile UX review, idempotency, and documents/branding. Eleven were marked PASS and mobile UX remained REVIEW pending a final human device pass.

This audit does **not** mark the application production-ready by itself. The complete UI/API/accounting acceptance matrix must still be rerun against the deployed application, with financial balances reconciled end-to-end.

## Release gate after this audit

1. Deploy/verify the `main` branch containing the hardening migration.
2. Run the full v1 acceptance matrix, not only the previous 12 scenarios.
3. Test owner/admin/accountant/staff/viewer permission boundaries.
4. Test cross-business reads and writes.
5. Reconcile invoice/payment/vendor/bank/inventory/report balances.
6. Complete the mobile/device pass.
7. Record the final production build result and any remaining P0/P1 issues.
