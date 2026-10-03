# Moneymatters

[![CI](https://github.com/svtrackpune/invoice-automation-saas/actions/workflows/ci.yml/badge.svg)](https://github.com/svtrackpune/invoice-automation-saas/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/svtrackpune/invoice-automation-saas)](https://github.com/svtrackpune/invoice-automation-saas/releases)
[![License](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-24.18.1-339933.svg)](https://nodejs.org/)
[![Next.js](https://img.shields.io/badge/Next.js-15.5.27-000000.svg)](https://nextjs.org/)
[![Supabase](https://img.shields.io/badge/Supabase-PostgreSQL-3ECF8E.svg)](https://supabase.com/)

Moneymatters is a production-oriented, multi-business invoicing and financial operations platform built with Next.js, Node.js, and Supabase/PostgreSQL.

It is designed around a simple principle: **one business can serve different customers in different billing modes without maintaining separate systems**. The application supports GST and non-GST sales, cash and UPI settlement, customer-specific document workflows, accounting controls, and operational workflows in the same business.

## Current release

**v1.4.0 — GA release line**

This release consolidates the production security perimeter, global tax foundations, offline POS, operational RBAC and SaaS entitlements, notification connections, payment adapter infrastructure, multi-currency accounting metadata, regulatory document fields, and the enterprise bank-reconciliation engine.

The canonical CI workflow is the release gate. It runs strict TypeScript checking, ESLint, production dependency auditing, the full automated test suite, a production build, and a Docker build.

## What the application does

### Billing and sales

- GST and non-GST sales can coexist in the same business.
- Cash and UPI settlement workflows are supported in the same business.
- Customer-specific billing requirements can be handled without creating separate businesses.
- Invoice, estimate, quotation, and receipt workflows are supported as distinct document types.
- Customer and transaction records remain tenant-scoped through the existing authorization and RLS architecture.

### Financial operations

- Atomic invoice, cash-bill, payment, purchase, expense, credit, refund, and settlement workflows.
- Accounting-period protection and locked-period enforcement.
- Financial write boundaries remain centered on transactional database RPCs.
- Posted journal entries and locked reconciliations remain protected from direct mutation; corrections use explicit reversal/correction paths.
- Dual-currency journal metadata and currency-aware AR/AP views are available for multi-currency accounting.

### Tax and regulatory foundations

- Global tax-rule and jurisdiction structures.
- Dynamic tax determination with snapshot persistence for posted invoices.
- India GST-compatible foundations and support for non-GST business modes.
- Buyer-reference support on invoices.
- Regulatory document requirements and structured tax-line snapshots.
- Provider-adapter boundary for external tax services.

### Payments and notifications

- Gateway payment recording with explicit gross/fee/net accounting.
- Idempotent payment webhook handling.
- PAYable adapter/session/webhook infrastructure.
- Tenant notification connections with provider-aware routing and failover infrastructure.
- Supported notification adapters include WAPI/WhatsApp, Telegram, Resend, and Twilio.

> **PAYable production note:** the current adapter provides the application-side integration boundary. A live PAYable merchant deployment must still be validated against the exact PAYable endpoint and signature/check-value contract configured for that account before enabling production traffic.

### Offline POS and bank reconciliation

- Offline-first cash-bill queue with durable device tickets and idempotent replay.
- CSV, CAMT.053, MT940, OFX, and QBO bank-statement parsing.
- Deterministic transaction fingerprinting for duplicate detection.
- Heuristic invoice/payment/gateway-fee matching and configurable categorization rules.
- Reconciliation locking with immutable-state protections and audited reversal workflow.

## Architecture

```
                        Operators / Customers
                                 |
                                 v
                   +---------------------------+
                   |       Next.js 15           |
                   | App Router + API routes    |
                   +-------------+-------------+
                                 |
                   +-------------v-------------+
                   |       Node.js 24.18.1      |
                   |        server.js           |
                   | healthz / readyz / APIs   |
                   +-------------+-------------+
                                 |
                   +-------------v-------------+
                   |       Supabase             |
                   | PostgreSQL + Auth + RLS    |
                   | transactional financial RPCs|
                   +----------------------------+

       Deployment A                                  Deployment B
       Plesk / Node.js                               Docker
       server.js                                     standalone image
```

The same application entrypoint and environment contract are used for Plesk and Docker deployments.

## Deployment

### Plesk

The supported Plesk target is Node.js **24.18.1** in production mode.

1. Set the application root to the repository root.
2. Use `server.js` as the startup file.
3. Configure the required environment variables through the Plesk Node.js environment settings.
4. Install with `npm ci`.
5. Build with `npm run build`.
6. Restart the application and verify `/healthz` and `/readyz`.

Plesk supplies `PORT`; `server.js` respects it and falls back to port 3000 for local execution.

### Docker

The repository contains a production Dockerfile and Compose configuration.

```bash
docker compose up --build
```

The application is exposed on `http://localhost:3000` in the standard local configuration.

## Environment variables

Use `.env.example` as the source of truth for deployment configuration.

| Variable | Scope | Required |
|---|---|---:|
| `NEXT_PUBLIC_SUPABASE_URL` | Browser + server | Yes |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Browser + server | Yes |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-only secret | For protected server operations |
| `MONEYMATTERS_PUBLIC_URL` | Server | For public delivery links |
| `PORT` | Server | No |
| `RESEND_API_KEY` | Server-only secret | Channel-dependent |
| `RESEND_FROM_EMAIL` | Server | Channel-dependent |
| `WHATSAPP_ACCESS_TOKEN` | Server-only secret | Channel-dependent |
| `WHATSAPP_PHONE_NUMBER_ID` | Server | Channel-dependent |
| `TWILIO_ACCOUNT_SID` | Server-only identifier | Channel-dependent |
| `TWILIO_AUTH_TOKEN` | Server-only secret | Channel-dependent |
| `TWILIO_FROM_NUMBER` | Server | Channel-dependent |
| `TELEGRAM_BOT_TOKEN` | Server-only secret | Channel-dependent |

**Never expose `SUPABASE_SERVICE_ROLE_KEY` or provider secrets through client code, `NEXT_PUBLIC_*` variables, logs, or source control.**

## Database migrations

The authoritative database schema is maintained under `supabase/migrations/`.

For the current GA rollout, the live Supabase project has been synchronized through the October 2026 release sequence, including the multi-currency foundation and Gates 0–3. Migration history is tracked in Supabase and should be treated as immutable deployment history.

Do not manually rewrite applied financial migrations. Create a new forward-only migration for any correction.

## Quality and release gate

Run the repository's canonical release checks:

```bash
npm ci
npm run typecheck
npm run lint
npm audit --omit=dev --audit-level=high
npm test
npm run build
docker build -t app:test .
```

The GitHub Actions CI workflow runs the same release gate on pull requests and pushes to `main`.

## Health and readiness

```bash
curl -i http://localhost:3000/healthz
curl -i http://localhost:3000/readyz
```

- `/healthz` is the shallow liveness probe.
- `/readyz` checks the configured Supabase dependency and returns an unavailable response when the database is not reachable.

## Security model

The production perimeter includes:

- Supabase Row Level Security and business-scoped authorization.
- Transactional financial RPC boundaries.
- Zod request validation for public API input.
- Centralized, sanitized API errors with correlation IDs.
- CSP nonces and hardened HTTP security headers.
- Explicit API CORS handling.
- Rate limiting for public receipt retrieval.
- Health/readiness probes and structured server lifecycle logging.
- Dependency vulnerability auditing in CI.
- Immutable posted-journal and locked-reconciliation controls with explicit reversal paths.

The application-level rate limiter is process-local. Horizontal deployments should use an infrastructure-level distributed limiter or shared store.

Supabase security advisors should also be reviewed before enabling new public production surfaces.

## Public HTTP API

OpenAPI documentation is available at [`docs/openapi.yaml`](docs/openapi.yaml).

The current public operational surface includes:

- `GET /healthz`
- `GET /readyz`
- `GET /api/receipts/pdf?token=...`

Additional server-side and tenant-authenticated routes are implemented in the application and are intentionally kept behind the normal authentication and authorization boundary.

## Project structure

```text
app/                    Next.js UI and route handlers
app/api/                HTTP API routes
lib/server/             Server-only domain and infrastructure code
lib/validations/        Request schemas and validation
supabase/migrations/    Database schema and security changes
supabase/functions/     Supabase Edge Functions
tests/                  Financial, contract, infrastructure and smoke tests
docs/                   API documentation
.github/workflows/      CI and release automation
Dockerfile              Production container definition
docker-compose.yml      Local container orchestration
server.js               Node entrypoint for Plesk and Docker
```

## Release automation

The release workflow runs after a successful CI workflow on `main`.

It reads the stable SemVer value from `package.json`, creates the corresponding Git tag, and publishes a GitHub Release. For this release:

```text
package.json  -> 1.4.0
Git tag       -> v1.4.0
GitHub Release-> v1.4.0
```

## Contribution and security reporting

- [Contributing](CONTRIBUTING.md)
- [Security Policy](SECURITY.md)
- [Changelog](CHANGELOG.md)
- [MIT License](LICENSE)

## License

MIT. See [`LICENSE`](LICENSE).
