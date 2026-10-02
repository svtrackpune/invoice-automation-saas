# Security Policy

## Supported versions

| Version | Supported |
|---|---|
| 1.0.x | Yes |
| < 1.0.0 | No |

Security fixes are applied to the current supported GA line. Users should upgrade to the latest supported release when a security advisory is published.

## Reporting a vulnerability

Please report suspected security vulnerabilities privately rather than opening a public GitHub issue.

**Preferred reporting channel:** GitHub Security Advisories for this repository.

If a private advisory cannot be created, contact the repository owner through the private contact mechanism associated with the GitHub repository account and include the repository name, affected version, impact, reproduction steps, and any relevant logs or proof-of-concept material.

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

## Coordinated disclosure

Please allow reasonable time for assessment and remediation before publicly disclosing a vulnerability. The project will coordinate disclosure timing with the reporter where appropriate.

## Security boundaries

The application uses Supabase RLS, server-side service-role operations, transactional financial boundaries, strict input validation, security headers, CSP, API CORS controls, rate limiting, and dependency auditing.

The `SUPABASE_SERVICE_ROLE_KEY` is a server-only credential and must never be exposed to client-side code or committed to source control. If you discover that a secret has been exposed, rotate it immediately and report the exposure privately.
