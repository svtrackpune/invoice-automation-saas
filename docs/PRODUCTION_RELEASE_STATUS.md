
# Production Release Status

Updated: 2026-10-02

## Release candidate

Branch: `production-ready-2026-10`
PR: #69
Base: `main`
Release head: `43228b0f6a98480f777581b6ba3a72e59ee20a13`

## Code-side hardening completed

- Cash Bill remains a first-class document with atomic creation, settlement and correction.
- Cash Bill correction remains popup-controlled and authoritative.
- Financial correction RPCs enforce accounting-period and journal-balance controls.
- Posted financial/operational ledgers are read-only to authenticated browser clients where controlled RPCs exist.
- Core audit triggers and Transaction 360 relationships are present.
- Receipt delivery is queued asynchronously and separated from accounting success.
- New-user onboarding is routed through production business setup; testing-mode signup behavior is removed.
- Node runtime is standardized to 22.23.3.
- Production dependency audit gate is enabled and currently passes on the release head.
- Vulnerable `xlsx` dependency was removed; spreadsheet features use the patched ExcelJS browser bundle.
- `sharp` is pinned to patched 0.35.5 through npm overrides.
- Live Supabase security/performance hardening was applied successfully, including RLS initplan fixes, permissive-policy cleanup, trigger-only receipt enqueue grant lockdown, explicit webhook-table deny policy, duplicate-index removal and high-value FK indexes.
- The latest `process-notifications` Edge Function version is deployed to the live Supabase project.

## Automated release evidence for exact head

All three release CI workflows passed on `43228b0f6a98480f777581b6ba3a72e59ee20a13`:

- Moneymatters build
- Moneymatters final quality pass
- Production Readiness

The Production Readiness workflow passed:
- `npm ci`
- TypeScript typecheck
- ESLint
- production dependency audit with no high/critical runtime findings
- financial invariant tests
- correction contract tests
- receipt-delivery contract tests
- production build

## Remaining release gates

1. Run the authenticated staging rehearsal with disposable staging Supabase fixtures.
2. Verify the complete correction matrix: quantity, rate, discount, GST/non-GST, location, batch and serial.
3. Verify subledger/GL/inventory/bank/report reconciliation with accountant/CA review.
4. Perform human mobile/device acceptance.
5. Verify the production WhatsApp/WAPI provider contract and templates.
6. Enable Supabase Auth leaked-password protection.
7. Only after these gates pass should PR #69 be merged.

## Explicit non-release roadmap

Offline sync/conflict resolution, deeper GST integrations/e-invoicing/e-way bill, OCR automation, AI action workflows and advanced operational modules remain separate product upgrades. They are intentionally excluded from the financial release hardening scope.
