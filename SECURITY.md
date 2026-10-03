# Security Policy

## Supported versions

| Version | Supported |
|---|---|
| 1.4.x | Yes |
| 1.3.x | Security fixes are maintained during the GA transition |
| < 1.3.0 | No |

Security fixes are applied to the supported GA line. Users should upgrade to the latest supported release when a security advisory is published.

## Reporting a vulnerability

Please report suspected security vulnerabilities privately rather than opening a public GitHub issue.

**Preferred reporting channel:** GitHub Security Advisories for this repository.

If a private advisory cannot be created, contact the repository owner through the private contact mechanism associated with the GitHub repository account and include the repository name, affected version, impact, reproduction steps, and relevant logs or proof-of-concept material.

Do not include production secrets, customer data, authentication tokens, service-role credentials, or other sensitive information in a public issue.

## What to include

A useful report should contain:

- affected version or commit
- affected endpoint, component, or deployment mode
- vulnerability description
- reproducible steps or proof of concept
- expected versus observed behavior
- security impact
- suggested mitigation, if known

## Response and remediation targets

These are target service levels, not contractual guarantees:

| Severity | Initial acknowledgement | Target remediation / mitigation |
|---|---:|---:|
| Critical | 1 business day | 7 calendar days |
| High | 2 business days | 14 calendar days |
| Medium | 5 business days | 30 calendar days |
| Low | 10 business days | Next planned maintenance release |

Critical and high-severity issues may trigger an out-of-band patch release when practical.

## Security boundaries

The application uses Supabase RLS, server-side service-role operations, transactional financial boundaries, strict input validation, security headers, CSP, API CORS controls, rate limiting, dependency auditing, accounting-period controls, and immutable posted-journal and locked-reconciliation protections.

The `SUPABASE_SERVICE_ROLE_KEY` is a server-only credential and must never be exposed to client-side code or committed to source control. If a secret is exposed, rotate it immediately and report the exposure privately.

## Production checks

Before a public production release:

1. Pass the canonical GitHub Actions CI gate.
2. Review Supabase security advisors for the target project.
3. Verify production secrets are configured only on the server.
4. Verify `/healthz` and `/readyz` after deployment.
5. Verify release tag and GitHub Release match `package.json`.
