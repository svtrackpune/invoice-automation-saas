# Moneymatters

Moneymatters is a multi-business financial workspace for small and growing businesses. It keeps sales documents, Cash Bills, payments, receipts, purchases, expenses, inventory, banking, accounting, tax configuration and business relationships on one business-scoped accounting source of truth.

## Architecture

- Next.js application with React and TypeScript.
- Supabase PostgreSQL, Auth, Storage and Edge Functions.
- Business-scoped authorization with RLS and controlled SECURITY DEFINER financial RPCs.
- Posted financial/operational ledgers are read-only to the browser; financial mutations use controlled transaction boundaries.
- Adaptive workspace configuration derives relevant modules from business facts without deleting core capabilities.
- Transaction 360 provides relationship views across customers, suppliers, invoices, purchases, payments, credits/refunds and related ledger records.

## Financial model

Cash Bills are first-class sales documents. A Cash Bill is created and settled atomically and is corrected through the Cash Bill correction workflow. Regular invoices, payments, purchase bills, expenses, credits and refunds use controlled accounting boundaries with period checks and journal-balance validation.

## Development

Use the Node version declared in `.nvmrc`.

```bash
npm ci
npm run dev
```

Quality gates:

```bash
npm run lint
npx tsc --noEmit
npm run test:financial
node --test tests/correction-contract.test.mjs
node --test tests/receipt-delivery-contract.test.mjs
npm run build
```

The production dependency gate is:

```bash
npm audit --omit=dev --audit-level=high
```

## Production staging rehearsal

The repository contains an authenticated staging rehearsal at `.github/workflows/production-staging-rehearsal.yml`.

It requires a disposable staging Supabase project and these GitHub environment secrets:

- `E2E_SUPABASE_URL`
- `E2E_SUPABASE_ANON_KEY`
- `E2E_USER_EMAIL`
- `E2E_USER_PASSWORD`
- `E2E_BUSINESS_ID`
- `E2E_PRODUCT_ID`
- `E2E_CASH_ACCOUNT_ID`

Optional second-tenant isolation checks:

- `E2E_SECOND_USER_EMAIL`
- `E2E_SECOND_USER_PASSWORD`
- `E2E_SECOND_BUSINESS_ID`

The smoke suite performs authenticated business-context validation, Cash Bill creation, payment/receipt cardinality checks, authoritative Cash Bill correction, and optional cross-business RLS verification. It is intentionally never pointed at production.

## Deployment

Plesk uses `server.js`. Production runtime configuration must provide the public Supabase URL/key plus the server-side notification/provider configuration documented in the production release runbook.

Never place service-role keys or provider secrets in client-exposed `NEXT_PUBLIC_*` variables.
