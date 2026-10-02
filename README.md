# Invoice Automation SaaS

[![CI](https://github.com/svtrackpune/invoice-automation-saas/actions/workflows/ci.yml/badge.svg)](https://github.com/svtrackpune/invoice-automation-saas/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/svtrackpune/invoice-automation-saas)](https://github.com/svtrackpune/invoice-automation-saas/releases)
[![License](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-24.18.1-339933.svg)](https://nodejs.org/)
[![Next.js](https://img.shields.io/badge/Next.js-15.5.27-000000.svg)](https://nextjs.org/)
[![Supabase](https://img.shields.io/badge/Supabase-PostgreSQL-3ECF8E.svg)](https://supabase.com/)

Production-grade, multi-business invoicing and financial operations software built with Next.js, Node.js, Supabase/PostgreSQL, and a hardened transaction-oriented financial domain.

The application is designed around flexible business billing: a business can support GST and non-GST sales, cash and UPI settlements, customer-specific billing requirements, and distinct invoice, estimate, quotation, and receipt workflows without forcing every customer into the same billing mode.

## Release status

**Current release: v1.0.0 — General Availability**

The release is verified by the canonical GitHub Actions CI pipeline, which performs type checking, linting, production dependency auditing, the complete automated test suite, a production build, and a Docker build.

## Architecture

```text
                         Public users / operators
                                   |
                                   v
                    +---------------------------+
                    |       Next.js 15           |
                    |  App Router + API routes   |
                    +-------------+-------------+
                                  |
                    +-------------v-------------+
                    |     Node.js 24.18.1       |
                    |       server.js           |
                    | healthz / readyz / APIs   |
                    +-------------+-------------+
                                  |
                    +-------------v-------------+
                    |       Supabase             |
                    | PostgreSQL + Auth + RLS    |
                    | atomic financial RPCs      |
                    +----------------------------+

       Deployment A                              Deployment B
       Plesk / Node.js                           Docker / Compose
       server.js                                 standalone image
``` 

### Deployment targets

- **Plesk:** Node.js 24.18.1, production mode, `server.js` as the application entrypoint.
- **Docker:** multi-stage Node 24.18.1 Alpine image, standalone Next.js output, non-root runtime user.
- Both deployment modes use the same application entrypoint and environment contract.

## Core domain capabilities

The financial engine has been hardened around explicit transaction and accounting boundaries. Important capabilities include:

- Atomic cash-bill creation and correction.
- Cash and UPI settlement validation.
- Invoice and payment correction workflows.
- Accounting-period protection and period locks.
- Over-allocation and paid-invoice protection.
- Purchase-bill, supplier-payment, expense, credit, refund, and customer-credit workflows.
- Supplier 360, Invoice 360, and Payment 360 financial views.
- Ledger write boundaries enforced through the existing database architecture.
- Receipt PDF generation with protected access tokens.
- Multi-channel notification workers for supported delivery channels.
- Tenant isolation through Supabase RLS and controlled server-side operations.

The release process deliberately protects these financial invariants. GA infrastructure changes do not rewrite the financial RPCs, accounting schema, or RLS boundaries.

## Technology stack

- Next.js 15.5.27
- React 19.3
- Node.js 24.18.1
- TypeScript 5.x with strict checking
- Supabase / PostgreSQL
- Zod validation
- Tailwind CSS 4
- Node native test runner
- Docker / Docker Compose
- GitHub Actions

## Environment configuration

Copy `.env.example` into the environment used by the deployment platform and provide real values there. Never commit credentials.

| Variable | Type | Default | Required | Scope |
|---|---|---|---|---|
| `PORT` | integer | `3000` | No | Server |
| `NEXT_PUBLIC_SUPABASE_URL` | URL | empty | Yes | Browser + server |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | string | empty | Yes | Browser + server |
| `SUPABASE_SERVICE_ROLE_KEY` | secret string | empty | Yes for protected server operations | **Server-only** |
| `MONEYMATTERS_PUBLIC_URL` | URL | empty | Yes for public delivery links | Server |
| `RESEND_API_KEY` | secret string | empty | Channel-dependent | Server-only |
| `RESEND_FROM_EMAIL` | email/string | empty | Channel-dependent | Server |
| `WHATSAPP_ACCESS_TOKEN` | secret string | empty | Channel-dependent | Server-only |
| `WHATSAPP_PHONE_NUMBER_ID` | string | empty | Channel-dependent | Server |
| `TWILIO_ACCOUNT_SID` | secret identifier | empty | Channel-dependent | Server-only |
| `TWILIO_AUTH_TOKEN` | secret string | empty | Channel-dependent | **Server-only** |
| `TWILIO_FROM_NUMBER` | phone string | empty | Channel-dependent | Server |
| `TELEGRAM_BOT_TOKEN` | secret string | empty | Channel-dependent | **Server-only** |

`SUPABASE_SERVICE_ROLE_KEY` is especially sensitive. It bypasses normal client-side authorization boundaries and must never be exposed through `NEXT_PUBLIC_*`, browser code, logs, source control, or client bundles.

## Quickstart

### Option A — Native development

Requirements: Node.js 24.18.1 and npm compatible with the repository lockfile.

```bash
npm ci
npm run dev
```

Open `http://localhost:3000`.

For a production-equivalent local run:

```bash
npm ci
npm run build
npm start
```

### Option B — Docker Compose

Configure the required values in a local environment file, then run:

```bash
docker compose up --build
```

The application is exposed on `http://localhost:3000` and the container healthcheck calls `/healthz`.

### Option C — Plesk production deployment

1. Select **Node.js 24.18.1** in Plesk.
2. Set application mode to **production**.
3. Use the repository root as the application root.
4. Use `server.js` as the startup file.
5. Bind all required variables from `.env.example` through the Plesk Node.js environment configuration.
6. Ensure `SUPABASE_SERVICE_ROLE_KEY` is configured only as a server-side environment variable.
7. Install dependencies with `npm ci` and build with `npm run build` when the Plesk deployment process requires an application build.
8. Verify `/healthz` and `/readyz` after restart.

Plesk supplies the listening `PORT`; `server.js` respects that value while retaining `3000` as the local/default fallback.

## Testing and verification

Run the complete local release gate:

```bash
npm ci
npm run typecheck
npm run lint
npm audit --omit=dev --audit-level=high
npm test
npm run build
docker build -t app:test .
```

The test suite protects both the financial domain and the production perimeter. It includes financial invariants, correction contracts, receipt delivery, production smoke checks, health/readiness behavior, rate limiting, security headers/CORS, and centralized error handling.

### Health checks

```bash
curl -i http://localhost:3000/healthz
curl -i http://localhost:3000/readyz
```

`/healthz` is a shallow liveness probe and does not depend on external services.

`/readyz` verifies the application can reach the configured Supabase database and returns `503` when the dependency is unavailable.

## Security and observability

The application perimeter includes:

- Strict request validation with Zod.
- Centralized structured API error responses with request correlation IDs.
- Sanitization of unexpected database/runtime errors before they reach clients.
- CSP with per-request nonces.
- `X-Content-Type-Options: nosniff`.
- `X-Frame-Options: DENY`.
- Strict referrer policy.
- HSTS in production.
- Restrictive Permissions Policy.
- Explicit API CORS handling.
- In-memory rate limiting for public endpoints such as receipt PDF retrieval.
- `/healthz` liveness and `/readyz` dependency readiness probes.
- Structured startup, shutdown, and server-error logging.
- Graceful `SIGTERM`/`SIGINT` handling for Plesk and container deployments.

The in-memory rate limiter is intended for a single application process. Multi-instance deployments should place distributed rate limiting at the infrastructure layer or replace the limiter with a shared store before scaling horizontally.

## API

The public HTTP surface is documented in [`docs/openapi.yaml`](docs/openapi.yaml).

Current documented endpoints:

- `GET /healthz`
- `GET /readyz`
- `GET /api/receipts/pdf?token=...`

## Project structure

```text
app/                 Next.js application routes and UI
app/api/             Public API routes
app/healthz/         Liveness probe
app/readyz/          Readiness probe
lib/server/           Server-only business/infrastructure helpers
lib/validations/      Zod request schemas
supabase/              Database migrations and server functions
tests/                 Contract, financial, infrastructure, and smoke tests
docs/                  API and release documentation
.github/workflows/     Canonical CI and release automation
Dockerfile             Production container image
server.js              Plesk/container Node entrypoint
```

## Release process

`main` is protected by the canonical CI workflow. CI must pass before the release workflow creates a GitHub Release.

The release workflow reads the stable SemVer version from `package.json`, creates the matching `vX.Y.Z` tag, and generates release notes from repository history.

For the current GA release:

```text
package.json -> 1.0.0
Git tag      -> v1.0.0
Release      -> v1.0.0
```

## Governance and security

- [Contributing](CONTRIBUTING.md)
- [Security Policy](SECURITY.md)
- [Changelog](CHANGELOG.md)
- [MIT License](LICENSE)

## License

This project is released under the MIT License. See [`LICENSE`](LICENSE).
