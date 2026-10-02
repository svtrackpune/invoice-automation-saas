# Production Release Runbook

## Release gate

Do not merge the financial release candidate until both automated and deployment-level gates are green.

### Automated

- TypeScript typecheck
- ESLint
- production dependency audit with no high/critical runtime vulnerabilities
- financial invariant tests
- correction contract tests
- receipt delivery contract tests
- production build

### Authenticated staging

Run **Production staging rehearsal** against a disposable staging Supabase project. The required fixture business must use a non-inventory product/service for the Cash Bill correction smoke test.

Required checks:

1. authenticated user resolves the configured business only;
2. Cash Bill creation produces one posted paid document;
3. exactly one inbound settlement payment exists;
4. exactly one receipt exists;
5. payment amount equals document total;
6. Cash settlement uses a Cash account;
7. Cash Bill correction changes the document and settlement atomically;
8. corrected amount_paid equals corrected total and balance_due is zero;
9. optional second-tenant test cannot read the first tenant's invoice.

### Human acceptance

Before production deployment:

- exercise invoice, Cash Bill, quotation, purchase, expense and payment correction from the UI;
- verify mobile layouts on the actual supported devices;
- verify Print / Save PDF and receipt PDF;
- verify customer/supplier/invoice/payment 360 links;
- verify reports reconcile with the ledger;
- verify accounting-period controls;
- verify WhatsApp/WAPI provider contract and templates in the deployment environment.

### Deployment controls

- In Supabase Auth settings, enable **Leaked Password Protection** before production sign-up is opened publicly.

- apply Supabase migrations in order;
- verify the authoritative receipt trigger remains the only automatic receipt-delivery enqueue route;
- verify notification-worker scheduling and provider credentials;
- verify backup/recovery readiness;
- confirm production build was produced from the exact release commit.

## Known non-release roadmap

Offline sync/conflict handling, deeper GST integrations/e-invoicing/e-way bill, OCR automation, AI action workflows and advanced operational modules remain separate product upgrades. They must not be introduced into the financial release as uncontrolled scope changes.
