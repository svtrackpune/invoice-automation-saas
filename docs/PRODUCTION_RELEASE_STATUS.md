# Production Release Status

Updated: 2026-10-02

## Release candidate

Branch: `production-ready-2026-10`
PR: #69
Base: `main`
Release head: `ba47652d93387e249fc0e99d3b001d22917d0320`

## Code-side hardening completed

- Cash Bill remains a first-class document with atomic creation, settlement and correction.
- Cash Bill correction remains popup-controlled and authoritative.
- Financial correction RPCs enforce accounting-period and journal-balance controls.
- Posted financial/operational ledgers are read-only to authenticated browser clients where controlled RPCs exist.
- Core audit triggers and Transaction 360 relationships are present.
- Receipt delivery is queued asynchronously and separated from accounting success.
- Production signup no longer uses testing-mode verification semantics.
- Node runtime is standardized to 22.23.3.
- Production dependency gate is enabled.
- Vulnerable `xlsx` dependency was removed; spreadsheet features use the patched ExcelJS browser bundle.
- `sharp` is pinned to patched 0.35.5 through npm overrides.
- Live Supabase security/performance hardening was applied successfully, including RLS initplan fixes, permissive-policy cleanup, trigger-only receipt enqueue grant lockdown, explicit webhook-table deny policy, duplicate-index removal and high-value FK indexes.

## Automated release evidence

The previous production-hardening head passed build, typecheck, lint, 25 correction/security contracts and 4 receipt-delivery contracts.

The latest dependency/runtime/spreadsheet/security changes were added after that evidence. GitHub currently has no CI result attached to the exact release head because repository-app workflow triggering is not available through the connected GitHub write path. Therefore the exact release head is **not certified green yet**.

## Required external release gates

1. Run the authenticated staging rehearsal with disposable staging Supabase fixtures.
2. Verify the complete correction matrix: quantity, rate, discount, GST/non-GST, location, batch and serial.
3. Verify subledger/GL/inventory/bank/report reconciliation with accountant/CA review.
4. Perform human mobile/device acceptance.
5. Verify the production WhatsApp/WAPI provider contract and templates.
6. Enable Supabase Auth leaked-password protection.
7. Re-run the production dependency audit on the exact release head.
8. Only after all gates pass should PR #69 be merged.

## Explicit non-release roadmap

Offline sync/conflict resolution, deeper GST integrations/e-invoicing/e-way bill, OCR automation, AI action workflows and advanced operational modules remain separate product upgrades. They are intentionally excluded from the financial release hardening scope.
