# Contributing

Thank you for contributing to Invoice Automation SaaS.

## Before you start

Please read the repository README, SECURITY.md, and the existing test suite before changing production behavior. Financial invariants, Supabase RLS policies, financial RPCs, and accounting write boundaries are protected areas.

## Development requirements

- Node.js 24.18.1
- npm compatible with the committed lockfile
- A configured Supabase project for integration work that requires the database

Install dependencies:

```bash
npm ci
```

## Branching

Create a focused branch from `main`:

```bash
git switch main
git pull --ff-only
git switch -c feat/short-description
```

Use prefixes such as:

- `feat/` — new functionality
- `fix/` — bug fixes
- `refactor/` — internal restructuring without behavior changes
- `test/` — test-only changes
- `docs/` — documentation
- `chore/` — tooling and maintenance
- `security/` — security hardening

Keep each branch focused on one coherent change.

## Conventional Commits

Commit messages should follow Conventional Commits:

```text
<type>(optional-scope): short imperative description
```

Examples:

```text
feat(invoice): add customer-specific receipt format
fix(receipt): reject expired access tokens
test(financial): cover payment over-allocation
security(api): restrict receipt endpoint origin
```

Breaking changes must be clearly marked according to the Conventional Commits specification.

## Local verification

Before opening a pull request, run the complete release gate:

```bash
npm ci
npm run typecheck
npm run lint
npm audit --omit=dev --audit-level=high
npm test
npm run build
docker build -t app:test .
```

Do not submit a pull request while any required check is failing.

## Financial-domain rules

Contributors must not casually modify:

- financial RPCs
- accounting schemas
- ledger write boundaries
- Supabase RLS policies
- transaction boundaries
- period-lock enforcement

If a change genuinely requires one of these areas, explain the invariant being preserved, add or update tests first, and document the migration impact in the pull request.

Never bypass a financial invariant to make a UI or API test pass.

## API changes

Public API mutations must validate incoming data with the repository's Zod validation layer and use the centralized error contract. New public endpoints must include tests and corresponding OpenAPI documentation.

## Pull requests

Every pull request should include:

1. A concise description of the problem and solution.
2. The affected user or system behavior.
3. Tests added or updated.
4. Verification commands and results.
5. Any database, migration, security, or deployment impact.
6. Any backward-compatibility considerations.

Keep pull requests reviewable. Avoid mixing unrelated refactors with functional changes.

## Review standards

Reviewers should verify:

- correctness and edge-case handling
- strict TypeScript behavior
- input validation and authorization
- tenant isolation
- financial invariant preservation
- safe error exposure
- test coverage
- documentation and API contract updates
- CI success

A pull request should not be merged with failing required checks or unexplained security/financial regressions.

## Release process

Releases are created from verified `main` commits by the repository's GitHub Actions release workflow. The workflow reads the stable SemVer version from `package.json` and creates the corresponding `vX.Y.Z` tag and GitHub Release only after CI succeeds.

Do not manually create release tags that conflict with `package.json`.
