# Changelog

All notable changes to this project are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project adheres to [Semantic Versioning](https://semver.org/).

## [1.3.0] - 2026-10-03

Strategic Gap Remediation release.

### Added

- Developer REST API under `/api/v1/*) with business-scoped API keys and outbound HMAC webhooks with retry delivery.
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

### Changed

- Production build now treats ESLint violations as blocking errors.
- Added an explicit strict TypeScript typecheck command.
- Standardized public API error responses and status handling.
- Consolidated CI responsibilities into a canonical `ci.yml` workflow.
- Consolidated release automation into `release.yml` with CI success as a prerequisite.
- Harmonized deployment behavior across Plesk and Docker using `server.js`.
- Replaced the starter README with production and deployment documentation.

### Fixed

- Removed obsolete repository backup artifacts and development-only release clutter.
- Prevented raw database/runtime error messages from being exposed through public API responses.
- Added validation handling for invalid receipt access tokens before database lookup.
- Added deterministic infrastructure tests for health, readiness, rate limiting, security headers, CORS, and error handling.
- Hardened shutdown behavior so in-flight requests can complete before process termination.

### Security

- Added strict server-side environment handling for the Supabase service-role credential.
- Added CSP with per-request nonces.
- Added `X-Content-Type-Options`, `X-Frame-Options`, Referrer-Policy, HSTS, and Permissions-Policy headers.
- Restricted API cross-origin behavior to the configured application origin.
- Added rate limiting and `Retry-After` responses for public receipt PDF access.
- Added dependency vulnerability checks to the canonical CI gate.
- Preserved Supabase RLS, financial RPC, transaction, and accounting write boundaries throughout release hardening.

[1.3.0]: https://github.com/svtrackpune/invoice-automation-saas/releases/tag/v1.3.0
[1.0.0]: https://github.com/svtrackpune/invoice-automation-saas/releases/tag/v1.0.0
