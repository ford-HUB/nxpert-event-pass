---
name: security-assessment
description: Static security assessment of the Event Registration app (.NET API + Angular SPA) mapped to OWASP Top 10 — 3 critical, 5 high, 7 medium, 6 low findings with locations, impact, remediation, and a P0/P1/P2 roadmap. Use when hardening, reviewing auth/CORS/secrets/rate limiting/email templates, or preparing for production exposure.
---

# Security Assessment (skill)

Full findings: [reference.md](reference.md). Standing rules: `.claude/rules/security.md`.
Method: static review (SAST-style); dynamic tests were **not** run — items marked
*[confirm dynamically]* need a live instance.

## Verdict

Sound on SQL injection (EF LINQ only), XSS (no innerHTML sinks), password hashing (PBKDF2 100k),
authorization/ownership checks, and mass assignment. **Not production-ready**: secrets, auth, and
configuration are the dominant risks.

## Findings index

| ID | Severity | Issue |
|----|----------|-------|
| C-1 | 🔴 | Secrets committed in `appsettings.json` (JWT key, Gmail app password) |
| C-2 | 🔴 | Default admin `admin@demo.com` seeded on startup |
| C-3 | 🔴 | Forgeable JWTs (predictable HS256 key) |
| H-1 | 🟠 | CORS reflects any origin with credentials |
| H-2 | 🟠 | Passwordless, non-expiring, reusable invite magic-links |
| H-3 | 🟠 | No server-side password policy |
| H-4 | 🟠 | No rate limiting / lockout |
| H-5 | 🟠 | Guest registration = unauthenticated mail relay / pass minting |
| M-1 | 🟡 | Unencoded HTML in email templates (`EmailTemplates.cs`) |
| M-2 | 🟡 | No HTTPS redirect / HSTS |
| M-3 | 🟡 | Missing security headers / CSP |
| M-4 | 🟡 | Capacity race (TOCTOU) |
| M-5 | 🟡 | Outbox writes passes/PII to disk unencrypted |
| M-6 | 🟡 | No token revocation (client-side logout only) |
| M-7 | 🟡 | Email/user enumeration on register |
| L-1…L-6 | ⚪ | Tenant isolation, ProblemDetails, public info disclosure, banner upload types, input length caps, dependency currency |

> The original assessment quoted the live Gmail app password in cleartext. It is **redacted** in
> this skill's copy. Treat that credential as compromised: revoke it and rotate the JWT key.

## Roadmap

- **P0 (before any exposure):** rotate/externalize secrets and scrub git history; remove seeded
  admin in production; strong JWT key (consider RS256); lock CORS, drop `AllowCredentials`;
  single-use expiring invite tokens, no auto-login from a link; server-side password policy; rate
  limiting + lockout; anti-automation on guest registration.
- **P1:** HTML-encode email fields; HTTPS/HSTS; security headers + CSP; capacity transaction;
  outbox handling; token revocation; neutral register response.
- **P2:** tenant filtering; ProblemDetails; length caps; `dotnet list package --vulnerable` and
  `npm audit` in CI; banner type allow-list.

## Recommended dynamic tests (not yet run — need explicit go-ahead to start the API)

Forged-JWT acceptance (C-3), CORS reflection (H-1), brute force / no lockout (H-4), guest-register
email flooding (H-5), authz matrix 401/403 across roles, error-response disclosure.
