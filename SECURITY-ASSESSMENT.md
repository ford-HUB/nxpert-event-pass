# Security Assessment — Event Registration App

**Assessor role:** Web application security expert
**Method:** Static code review (SAST-style) of the .NET API and Angular SPA, mapped to the
OWASP Top 10 (2021). Dynamic/runtime testing was **not** performed in this pass (no live
target exercised) — findings that would benefit from runtime confirmation are marked
*[confirm dynamically]*. Confidence is nonetheless high; every finding cites the code.
**Scope:** `backend/EventRegistration.Api` and `frontend/web`.

---

## 1. Executive summary

The application is **architecturally sound in two important areas** — data access is fully
parameterized (no SQL injection) and the Angular UI keeps output encoding intact (no XSS
sinks). Passwords are hashed properly (PBKDF2), and role-based authorization plus ownership
checks are applied consistently.

However, the app is **not production-ready from a security standpoint.** The dominant risks
are **secret management, authentication, and configuration**: a predictable JWT signing key
and a **live Gmail app password are committed in source**, a **default admin account** is
seeded on startup, CORS is wide-open with credentials, invite links are **passwordless and
non-expiring**, and there is **no rate limiting or server-side password policy**.

| Severity | Count |
|----------|-------|
| 🔴 Critical | 3 |
| 🟠 High | 5 |
| 🟡 Medium | 7 |
| ⚪ Low / Info | 6 |

**Fix before any production/internet exposure:** all Critical + High items (§3–§4).

---

## 2. What's done well (positive findings)

- **No SQL injection** — all data access is EF Core LINQ; no `FromSqlRaw`/string-built SQL.
- **No XSS sinks in the SPA** — no `innerHTML`, `bypassSecurityTrust*`, or `[innerHTML]`;
  Angular's contextual auto-escaping protects rendered user data (event titles, names,
  custom-field answers, feedback comments).
- **Strong password hashing** — PBKDF2/SHA-256, 100k iterations, 16-byte per-user salt,
  constant-time comparison (`PasswordHasher.cs`).
- **Consistent authorization** — admin endpoints use `[Authorize(Roles = Admin/SuperAdmin)]`;
  `Cancel`/`ResendPass` enforce ownership (`reg.UserId != UserId() → Forbid`) — no obvious IDOR.
- **Mass-assignment safe** — request DTOs are minimal records; `Role` is hard-coded to
  `Participant` at registration and never bound from input.
- **Email verification token is single-use** — nulled after use.
- **SMTP over STARTTLS.**

---

## 3. Critical findings 🔴

### C-1 — Secrets committed in source (`appsettings.json`)
**OWASP:** A05 Misconfiguration / A02 Cryptographic Failures · **Location:** `appsettings.json`

Two live secrets are checked into the repository:
- **JWT signing key** = `DEV_ONLY_super_secret_signing_key_change_me_please_32+chars` — a
  low-entropy, human-readable, guessable string.
- **Gmail App Password** = `dpnlsmcoqqdkihnx` (in cleartext), with the sending account.

**Impact:** Anyone with the source (or who guesses the key) can **forge valid JWTs for any
user, including an admin** → full account/administrative takeover (see C-3). The Gmail
credential allows sending mail as the org and is itself a compromised secret the moment it's
committed.
**Remediation:**
1. **Rotate both now** — generate a new 256-bit random JWT key; revoke the Gmail app password
   and issue a new one.
2. Move all secrets to environment variables / .NET user-secrets / a vault. Never commit them.
3. Scrub git history (the old values remain in history even after edits).

### C-2 — Default admin credentials seeded on startup
**OWASP:** A07 Auth Failures · **Location:** `Data/DbSeeder.cs`

On first run the seeder creates `admin@demo.com` / `Admin123!` with `Role = Admin`,
`EmailVerified = true`. If deployed without change, this is a **known admin login on the
public internet**.
**Remediation:** Don't seed a real admin in production; provision the first admin via a
one-time secured step (env-provided password, or an out-of-band setup), and force a password
change. Gate seeding to the Development environment only.

### C-3 — Forgeable JWTs (predictable HS256 key)
**OWASP:** A07 · **Location:** `Services/JwtService.cs` + `Program.cs`

Tokens are HS256-signed with the C-1 key. Because that key is predictable/committed, an
attacker can mint a token with `role = Admin` and any `nameidentifier`. `TokenValidationParameters`
are otherwise correct (issuer/audience/lifetime validated). *[confirm dynamically]* — a forged
token should be tested against an admin endpoint once the key is known.
**Remediation:** Fixed by C-1 (strong secret key). Additionally consider asymmetric signing
(RS256) so the verifying service never holds a secret that can mint tokens. Add a `jti` and a
revocation story (see M-6).

---

## 4. High findings 🟠

### H-1 — Wide-open CORS with credentials
**OWASP:** A05 · **Location:** `Program.cs` (`SetIsOriginAllowed(_ => true) … AllowCredentials()`)

The policy reflects **any** Origin and allows credentials, any header, any method. Any website
a user visits can script authenticated cross-origin requests to the API and **read the
responses**. *[confirm dynamically]* — verify `Access-Control-Allow-Origin` reflects an
arbitrary `Origin` with `Allow-Credentials: true`.
**Remediation:** Restrict to the known SPA origin(s) via `WithOrigins(...)`; only enable
`AllowCredentials` if you actually use cookies (this app uses Bearer tokens, so you likely
don't need it). Never combine reflect-any-origin with credentials.

### H-2 — Passwordless, non-expiring invite magic-links
**OWASP:** A07 · **Location:** `AuthController.ResolveInvite` + `InvitationsController`

Opening `/e/{slug}?invite={token}` **logs the user in automatically** and the token is
**never expired and never invalidated** (reusable). Anyone who obtains the link — forwarded
email, browser history, referrer header, proxy/log — gains that user's session.
**Remediation:** Make invite tokens **single-use and time-limited** (e.g. 72h); rotate on use;
don't fully authenticate from a link — use it to pre-fill identity and still require the
account's normal login for a real session, or issue a short-lived, narrowly-scoped token.

### H-3 — No server-side password policy
**OWASP:** A07 · **Location:** `AuthController.Register`

The server only checks the password is non-empty; the 8-char/letter+digit rule exists **only
in the Angular form** and is trivially bypassed by calling the API directly. Weak passwords
(e.g. `a`) can be stored.
**Remediation:** Enforce length/complexity server-side (min 8–12, complexity or breached-password
check) in the register/change flows.

### H-4 — No rate limiting / brute-force protection / lockout
**OWASP:** A07 · **Location:** `Program.cs` (no `AddRateLimiter`), `AuthController.Login`

Login, register, verify, invite, and guest-register have **no throttling or lockout**.
Credential brute-forcing and endpoint abuse are unrestricted. *[confirm dynamically]* — rapid
login attempts return no 429/lockout.
**Remediation:** Add ASP.NET rate limiting (strict on `/api/auth/*` and guest registration),
plus per-account failed-login lockout/backoff.

### H-5 — Unauthenticated mail relay & pass leakage via guest registration
**OWASP:** A04 Insecure Design / A05 · **Location:** `RegistrationsController.GuestRegister`

The anonymous guest endpoint sends a **valid QR entry pass email to any address the caller
supplies**, unthrottled, and re-sends on repeat calls. This enables **email bombing** of
arbitrary victims and abuse of the org's Gmail reputation, and lets an attacker mint entry
passes at will.
**Remediation:** Rate-limit and add anti-automation (captcha/proof-of-work) on guest
registration; consider only emailing the pass after a confirmation step; cap emails per
address/IP/time.

---

## 5. Medium findings 🟡

### M-1 — HTML/email injection (unencoded interpolation)
**OWASP:** A03 Injection · **Location:** `Services/EmailTemplates.cs`

`ev.Title`, `ev.Venue`, `ev.Description`, `user.FullName`, `attendeeName` are interpolated
straight into email HTML. A crafted value (e.g. an event description with `<a>`/`<img>`) is
injected into invitation/pass emails sent to recipients → phishing/content spoofing.
**Remediation:** HTML-encode all interpolated values before insertion; keep URLs
server-constructed only.

### M-2 — No HTTPS enforcement / HSTS on the API
**OWASP:** A02 · **Location:** `Program.cs` (no `UseHttpsRedirection`/HSTS)

If the API is ever reachable over HTTP, Bearer tokens and credentials travel in clear.
**Remediation:** Enforce HTTPS (redirect + HSTS) at the app and/or reverse proxy.

### M-3 — Missing security headers
**OWASP:** A05 · **Location:** API responses (none set); SPA has partial headers only.

No `Content-Security-Policy`, `X-Frame-Options`/frame-ancestors, `Referrer-Policy`, or
`X-Content-Type-Options` from the API. Reduces defense-in-depth (clickjacking, MIME sniffing,
referrer leakage of invite tokens — ties to H-2).
**Remediation:** Add a strict CSP and the standard header set on the SPA host; set
`Referrer-Policy: no-referrer` where invite tokens appear in URLs.

### M-4 — Capacity race condition (TOCTOU)
**OWASP:** A04 · **Location:** `RegistrationsController.RegistrationBlockedReason`

Capacity is enforced by count-then-insert without a transaction/lock; concurrent registrations
can exceed `Capacity`.
**Remediation:** Enforce atomically (transaction + re-check, unique constraint, or DB-level guard).

### M-5 — Outbox writes passes/PII to disk unencrypted
**OWASP:** A09/A02 · **Location:** `Services/EmailService.WriteToOutboxAsync`

When email is disabled or a send fails, full HTML emails **and QR entry-pass PNGs** are written
to `outbox/` in cleartext. On a server these persist and disclose PII + valid passes.
**Remediation:** Disable the outbox in production, or write to a protected location with
retention/cleanup; never fall back to disk for real sends silently.

### M-6 — No token revocation (client-side logout only)
**OWASP:** A07 · **Location:** `AuthService.logout` (SPA) + JWT design

Logout only deletes the token from `localStorage`; a stolen token stays valid up to 8h with no
server-side revocation.
**Remediation:** Shorten lifetime + add refresh tokens, or a `jti` deny-list / token-version
claim to invalidate on logout/compromise.

### M-7 — User/email enumeration
**OWASP:** A07 · **Location:** `AuthController.Register` ("account … already exists")

Register discloses whether an email is registered.
**Remediation:** Return a neutral response and email the user out-of-band; apply the same
timing/response for existing vs. new.

---

## 6. Low / informational ⚪

- **L-1 Tenant isolation not enforced** — `CompanyId` exists on entities but no query filters
  by it. Harmless while single-company, but adding multi-tenancy would leak cross-tenant data
  (contacts, events, attendance). *(A01)*
- **L-2 No global exception handler / ProblemDetails** — ensure Production hides stack traces
  (default ASP.NET behavior does; verify `ASPNETCORE_ENVIRONMENT=Production`). Add
  `AddProblemDetails()` for consistent, non-leaky errors. *(A05)*
- **L-3 Anonymous info disclosure** — `GET /api/events/public/{slug}` exposes registered /
  checked-in counts and the full custom-form schema to anyone. Usually acceptable; confirm
  it's intended. *(Low)*
- **L-4 Banner upload accepts any `data:image/*` (incl. SVG), up to ~2 MB** stored per event.
  SVG-in-`<img>` is not script-executable (low XSS risk), but consider allow-listing raster
  types and validating actual image bytes; large blobs are a storage/DoS vector. *(A05)*
- **L-5 Sparse server-side input validation** — feedback comments and custom-field answers are
  unbounded (`nvarchar(max)`); no length caps server-side → storage abuse. Add DTO validation
  (see the project's `VALIDATIONS.md`). *(A03/A04)*
- **L-6 Dependency currency** — pinned `EF Core 10.0.0`, `JwtBearer 10.0.0`, `MailKit 4.17.0`,
  `QRCoder 1.8.0`. Run `dotnet list package --vulnerable` and `npm audit` in CI and patch on a
  schedule. *(A06)*

---

## 7. Prioritized remediation roadmap

**P0 — before any exposure (Critical + High):**
1. Rotate & externalize secrets (C-1); scrub git history.
2. Remove seeded default admin from production (C-2); provision securely.
3. New strong JWT key / consider RS256 (C-3).
4. Lock down CORS to known origins, drop `AllowCredentials` unless needed (H-1).
5. Invite tokens single-use + expiring; stop full auto-login from a link (H-2).
6. Server-side password policy (H-3).
7. Rate limiting + login lockout (H-4); anti-automation on guest register (H-5).

**P1 — hardening:**
8. HTML-encode email template fields (M-1); HTTPS/HSTS (M-2); security headers + CSP (M-3);
   capacity transaction (M-4); outbox handling (M-5); token revocation (M-6); neutral
   register response (M-7).

**P2 — depth & hygiene:**
9. Tenant filtering when multi-company (L-1); ProblemDetails + confirm prod error hiding (L-2);
   input-length validation (L-5); dependency scanning in CI (L-6); banner type allow-list (L-4).

---

## 8. Dynamic tests recommended (not yet run)

To confirm the *[confirm dynamically]* items and close the loop, run against a live instance
(with your permission to start it): forged-JWT acceptance (C-3), CORS reflection (H-1),
brute-force/no-lockout (H-4), guest-register email flooding (H-5), authz enforcement matrix
(401/403 across roles), and error-response disclosure. I can execute these and append results
if you start the API.
