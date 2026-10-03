# Changelog

All notable changes to Moneymatters are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses [Semantic Versioning](https://semver.org/).

## [1.4.0] - 2026-10-03

Production GA consolidation release.

### Added

- Enterprise bank-statement parsing for CSV, CAMT.053, MT940, OFX, and QBO inputs.
- Deterministic bank-transaction fingerprints and duplicate-detection constraints.
- Bank reconciliation rules, heuristic matching, gateway-fee tolerance, locking, immutable mutation guards, and audited reversal support.
- Tenant notification connections with provider-aware routing and failover infrastructure.
- Offline POS capability with durable cash-bill replay boundaries and SaaS entitlement enforcement.
- Operational RBAC roles for cashier and auditor workflows with database-backed permission definitions and deny-by-default mutation boundaries.
- Dynamic tax determination and posted-invoice tax snapshots.
- Regulatory buyer-reference support and dynamic invoice RPC surfaces.
- Multi-currency accounting metadata, currency-aware payment allocations, and base-currency safeguards.
- Provider-neutral PAYable payment adapter/session/webhook infrastructure.
- Gateway settlement accounting with explicit gross, fee, and net amounts.
- SaaS entitlement records and feature gates for API, e-invoicing, and offline POS capabilities.

### Security

- Pinned the bank-transaction fingerprint helper to trusted PostgreSQL schemas to remove search-path ambiguity in the production database.
- Hardened API authorization, error sanitization, security headers, CORS handling, and rate limiting from the production perimeter work.
- Preserved financial write boundaries and accounting-period controls while expanding operational capabilities.
- Revoked direct mutation paths for locked bank reconciliations; corrections require explicit audited reversal context.
- Preserved tenant isolation through Supabase RLS and controlled server-side operations.
- Added production dependency auditing to the canonical CI gate.
- Synchronized the live Supabase schema through the October 2026 GA migration sequence.

### Operations

- Verified the Gate 3 bank-reconciliation implementation through the repository CI pipeline, including typecheck, lint, tests, production build, and Docker build.
- Preserved compatibility with Plesk Node.js 24.18.1 deployment and the Docker deployment target.
- Standardized release automation around package SemVer and matching Git tags.

### Integration note

- The PAYable application adapter is intentionally provider-boundary code. Before enabling live PAYable traffic, confirm the exact merchant endpoint and signature/check-value contract for the account being connected.

## [1.3.0] - 2026-10-03

Strategic Gap Remediation release.

### Added

- Developer REST API under `/api/v1/*` with business-scoped API keys and outbound HMAC webhooks with retry delivery.
- Regulatory e-invoicing document paths for PEPPOL UBL 2.1 and Factur-X/ZUGFeRD 2.5.2 with structural fail-closed validation.
- Offline-first IndexedDB POS queue for cash bills with durable device ticket sequencing and idempotent server replay.
- Operational RBAC roles: Owner, Admin, Accountant, Cashier, and Auditor, with database-backed permission enforcement and SaaS entitlements.
- Dynamic tax determination through a pluggable provider with jurisdiction metadata and EU VAT reverse-charge detection/validation.

### Security & Scope

- Preserved existing financial RPCs as the accounting posting boundary.
- Preserved existing Treasury / Bank Reconciliation, Plaid, and ISO 20022 boundaries.
- Preserved immutable invoice tax-line snapshot protections.
- Offline replay deduplicates before entering the existing Cash Bill financial workflow.
- Public API authorization remains business-scoped.

## [1.0.0] - 2026-10-02

Initial Production GA Release.

### Added

- Multi-business billing workflows supporting GST and non-GST sales and customer-specific billing requirements.
- Cash and UPI settlement workflows with explicit payment handling.
- Invoice, estimate, quotation, receipt, purchase, expense, credit, refund, and payment workflows.
- Atomic cash-bill creation and correction boundaries.
- Financial correction contracts and invariant tests.
- Invoice and payment correction protections.
- Accounting-period protection and period-lock enforcement.
- Supplier and customer credit/refund workflows.
- Supplier 360, Invoice 360, and Payment 360 financial views.
- Receipt PDF generation using protected, time-limited access tokens.
- Multi-channel notification worker infrastructure.
- Strict Zod validation for public API input.
- Centralized structured API errors with request correlation IDs.
- Liveness and readiness probes at `/healthz` and `/readyz`.
- Security middleware with CSP nonces, security headers, and explicit API CORS handling.
- Application-level rate limiting for public receipt retrieval.
- Graceful Node.js shutdown handling for Plesk and container deployments.
- Multi-stage Node 24.18.1 Alpine Docker image and Docker Compose verification stack.
- Deterministic GitHub Actions CI and automated SemVer release workflow.
- OpenAPI 3.1 documentation for the public HTTP surface.
- MIT open-source licensing, contribution guidelines, and security policy.

[1.4.0]: https://github.com/svtrackpune/invoice-automation-saas/releases/tag/v1.4.0
[1.3.0]: https://github.com/svtrackpune/invoice-automation-saas/releases/tag/v1.3.0
[1.0.0]: https://github.com/svtrackpune/invoice-automation-saas/releases/tag/v1.0.0
