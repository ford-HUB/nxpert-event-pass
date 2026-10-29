# Validation Specification — Production Readiness

**Author:** Technical Architect
**Scope:** every input surface (each screen/form) and its server-side counterpart, plus the
cross-cutting guards required before this system is production-ready.

This is the contract for what "valid input" means end-to-end. It is written against the
**current** codebase and marks each item:

- ✅ **In place** today
- ⚠️ **Partial** (present but insufficient)
- ❌ **Missing** (must be added for production)

---

## 1. Validation layers (defense in depth)

Every rule below is enforced at the **server** (authoritative). The client layer exists only
for UX (fast feedback), never for security.

| Layer | Where | Responsibility |
|-------|-------|----------------|
| **L1 — Client** | Angular forms | Immediate feedback, disable submit, format hints. Never trusted. |
| **L2 — API/DTO** | `[ApiController]` + DataAnnotations / FluentValidation | Shape, presence, length, format, range. Rejects with `400`. |
| **L3 — Business rules** | Controllers/services | Cross-entity rules (capacity, closed, duplicates, ownership, invite-only). Rejects with `403/409/422`. |
| **L4 — Database** | EF constraints + indexes | Last line: unique indexes, max-length columns, FKs, non-null. |

> **Current gap:** L2 is effectively absent — DTOs are plain records with no annotations and
> controllers don't inspect `ModelState`. All validation today is hand-written L3 checks.
> The single most important production change is to introduce a real L2 (Section 7).

### Standard error response (❌ add)

All validation failures should return a consistent shape (RFC 7807 `ProblemDetails`), e.g.:

```json
{ "status": 400, "title": "Validation failed",
  "errors": { "email": ["A valid email address is required."],
              "password": ["Password must be at least 8 characters."] } }
```

Enable `builder.Services.AddProblemDetails()` and a global exception handler so unhandled
errors never leak stack traces.

---

## 2. Canonical field rules (referenced throughout)

Define once; reuse everywhere. Lengths align with the EF `[MaxLength]` columns.

| Key | Rule |
|-----|------|
| **Name** | Required. Trimmed. 2–200 chars. Not only whitespace. |
| **Email** | Required (where noted). Trimmed, lower-cased. Valid RFC 5322 format. ≤ 256 chars. |
| **Password** | Required. 8–128 chars. Must contain at least one letter and one digit. Not equal to email. |
| **Phone** | Optional. 7–40 chars. Pattern `^[0-9+()\-\s]+$`. Digits count ≥ 7. |
| **Organization** | Optional. ≤ 200 chars. |
| **Event title** | Required. Trimmed. 3–300 chars. |
| **Description** | Optional. ≤ 4000 chars. |
| **Venue** | Required. Trimmed. ≤ 300 chars. |
| **Start/End datetime** | Both required. Valid datetime. **End > Start.** New events: **Start ≥ today** (warn, not block, on edit of past events). |
| **Capacity** | Optional. Integer **≥ 1** (blank = unlimited). On edit: **must be ≥ current registration count**. |
| **Status** | One of `Draft` \| `Published` \| `Closed` (enum whitelist). |
| **Rating** | Required. Integer **1–5**. |
| **Comment (feedback)** | Optional. ≤ 1000 chars. |
| **Token / slug** | Must parse as GUID (registration/invite/verify tokens); slug `^[a-z0-9-]{1,100}$`. |

**Global input hygiene (❌ add):** trim all strings; reject control chars; cap request body
size (e.g. 256 KB) via Kestrel limits; HTML-encode on display (Angular does this by default —
never use `[innerHTML]` with user data).

---

## 3. Screen-by-screen validations (Client — L1)

### 3.1 Login (`/login`)
| Field | Rules | Status |
|-------|-------|--------|
| Email | Required; email format | ⚠️ required ✅, format ❌ |
| Password | Required | ✅ |
| Form | Submit disabled until both present; show server "invalid credentials" without revealing which field; disable button while in flight | ⚠️ (no in-flight lock beyond `loading`) |

### 3.2 Register participant (`/register`)
| Field | Rules | Status |
|-------|-------|--------|
| Full name | Name rule | ⚠️ required only |
| Email | Email rule; show "already registered" on 409 | ⚠️ required only; format ❌ |
| Password | Password rule (8+, letter+digit); show strength/why | ❌ (only non-empty) |
| Phone | Phone rule (optional) | ❌ |
| Organization | ≤ 200 (optional) | ❌ |

### 3.3 Public / guest registration (`/e/:slug`)
| Field | Rules | Status |
|-------|-------|--------|
| Full name | Name rule (required) | ✅ required |
| Email | Email format if provided | ⚠️ type=email only |
| Phone | Phone rule if provided | ❌ |
| **At least one contact** | Require **email OR phone** so the attendee is reachable/identifiable (decision — see §6) | ❌ |
| Guard | Hide form and show reason when event **full/closed/invite-only** | ✅ |

### 3.4 Event create / edit (`/admin/events/new`, `/:id/edit`)
| Field | Rules | Status |
|-------|-------|--------|
| Title | Title rule | ⚠️ required only |
| Description | ≤ 4000 | ❌ |
| Start date + time | Required | ✅ required |
| End date + time | Required; **after start** | ⚠️ required; end>start ❌ |
| Venue | Required; ≤ 300 | ⚠️ required only |
| Status | Enum | ✅ (select) |
| Max participants | Integer ≥ 1 or blank; **not below current registrations** on edit | ⚠️ min=1 only |
| Submit | Disabled until valid; inline field errors | ⚠️ presence gate only |

### 3.5 Event detail — Invite tab (`/admin/events/:id`)
| Field | Rules | Status |
|-------|-------|--------|
| Additional emails | Each token must be valid email; de-dupe; cap count per send (e.g. ≤ 200); show which are invalid | ❌ |
| Send | Require ≥ 1 recipient (picked or typed) | ✅ |
| Search box | Trim; harmless if empty | ✅ |

### 3.6 Feedback dialog (My Events → Rate)
| Field | Rules | Status |
|-------|-------|--------|
| Rating | Required 1–5; submit disabled until chosen | ✅ |
| Comment | ≤ 1000 chars; counter | ❌ |

### 3.7 Scanner (`/scanner`)
| Concern | Rules | Status |
|---------|-------|--------|
| Camera/secure-context | Detect no-HTTPS / permission denied and show guidance | ✅ |
| Payload | Ignore non-`REG:{guid}` scans gracefully (no crash) | ✅ (server returns `invalid`) |
| Debounce | Don't re-post the same code repeatedly | ✅ |

### 3.8 Verify email (`/verify/:token`)
| Concern | Rules | Status |
|---------|-------|--------|
| Token | Handle invalid/expired/used token with a clear message | ⚠️ handles invalid; **no expiry** ❌ |

**Client mechanism recommendation:** move the template-driven forms to **Reactive Forms** with
`Validators` (email, minLength, pattern, custom `endAfterStart`, `atLeastOne`), showing
`mat-error` messages per field. This is more testable and avoids the zoneless `[(ngModel)]`
pitfalls already encountered.

---

## 4. API / DTO validations (Server — L2) — ❌ largely missing

Annotate every request DTO and let `[ApiController]` auto-return `400 ProblemDetails`.

| DTO | Rules to enforce |
|-----|------------------|
| `LoginRequest` | Email required+format; Password required. |
| `RegisterRequest` | Name (2–200); Email required+format+≤256; Password (8–128, letter+digit); Phone pattern; Org ≤200. |
| `GuestRegisterRequest` | Name required (2–200); Email format if present; Phone pattern if present; **email or phone required**. |
| `EventUpsertRequest` | Title (3–300); Description ≤4000; Venue (≤300); Start/End required; **End>Start** (class-level `IValidatableObject`); Status ∈ enum; Capacity null or ≥1. |
| `InviteRequest` | Non-empty list; each a valid email; ≤200 items; de-dupe server-side. |
| `FeedbackRequest` | Rating 1–5 (already checked in L3 — move to attribute); Comment ≤1000. |
| `CheckInRequest` | Token required; must parse to GUID (already handled → keep, return `invalid`). |
| Route tokens | `{slug}`, `{token}`, `{id:int}` — constrain in routing; GUID-parse tokens. |

> Keep the existing manual business checks (they're L3), but add L2 so malformed payloads are
> rejected *before* reaching business logic, uniformly and with field-level messages.

---

## 5. Business-rule validations (Server — L3)

| Rule | Current | Notes |
|------|---------|-------|
| Login: wrong credentials → 401, no user-enumeration | ✅ | Keep generic message. |
| Register: duplicate email → 409 | ✅ | Also enforce format/strength (L2). |
| Event registration blocked when **Closed** | ✅ | |
| Event registration blocked when **Full** (capacity) | ✅ | ⚠️ **race condition**: two concurrent registrations can both pass the count check and exceed capacity. Add a transaction + re-check, or a DB-level guard. |
| **Invite-only** event: only invited email may register | ✅ | |
| Duplicate registration (same user/email/phone) reused, not duplicated | ✅ | |
| Capacity on edit must be **≥ current registrations** | ❌ | Prevent setting capacity below people already in. |
| Email verification gate (when enabled) | ✅ | ⚠️ tokens **never expire / not single-use** — add expiry (e.g. 24h) + invalidate on use. |
| Invite magic-link auto-login | ✅ | ⚠️ passwordless by link possession — **make tokens single-use + expiring** before production. |
| Resend pass / cancel: **ownership** check (owner or admin) | ✅ | |
| Cancel blocked after check-in | ⚠️ | Enforced in UI; **add server check** too. |
| Feedback only by a **registered** attendee; one per user/event | ✅ | |
| CSV export / attendance / dashboard: **admin-only** | ✅ | Role attributes present. |
| Slug uniqueness, registration token uniqueness | ✅ | DB unique indexes. |

---

## 6. Open decisions (need product sign-off)

1. **Guest reachability:** require **email OR phone** on guest registration? (Recommended: yes —
   otherwise an attendee has no pass delivery and no dedupe key.) Currently name-only is allowed.
2. **Past-dated events:** block creating events in the past, or warn only? (Recommended: warn.)
3. **Password policy strength:** 8 + letter + digit (recommended baseline) vs. stricter.
4. **Invitation cap per send:** hard limit (recommended ≤ 200 to respect Gmail limits).
5. **Email verification default:** currently off; production likely **on**.

---

## 7. Cross-cutting production guards (❌ add) — priority order

These are not "screens" but are required to call the system production-ready.

**P0 — Security & integrity**
- [ ] **DTO validation (L2)** via DataAnnotations + `[ApiController]` auto-400 (Section 4).
- [ ] **Move secrets out of `appsettings.json`** (JWT key, Gmail password) → env vars / user-secrets / Key Vault. The committed key must be rotated.
- [ ] **Tighten CORS** from allow-all to the known frontend origin(s).
- [ ] **HTTPS enforcement** (`UseHttpsRedirection` / HSTS) — also required for the scanner camera.
- [ ] **Rate limiting** (`AddRateLimiter`): strict on `/api/auth/*` (login, register, verify, invite) and guest registration to prevent brute force / spam.
- [ ] **Capacity race fix** (transaction/DB guard, Section 5).
- [ ] **Token hardening**: expiry + single-use for verification and invite magic-links.

**P1 — Robustness**
- [ ] **Global exception handler + `ProblemDetails`**; never leak stack traces.
- [ ] **Request body size limit** (Kestrel `MaxRequestBodySize`) and JSON depth limits.
- [ ] **Email sending resilience**: already falls back to outbox; add ret/throttle + per-address failure reporting.
- [ ] **Anti-automation on public registration** (e.g. lightweight honeypot / captcha if abused).
- [ ] **Consistent server-side trimming/normalization** of all string inputs.

**P2 — Operational**
- [ ] **Structured logging** with correlation IDs; audit log for admin actions (create/close/delete, check-in).
- [ ] **Health check** endpoint for the DB.
- [ ] **Unit/integration tests** for each validation rule above (regression safety).

---

## 8. Suggested implementation sequence

1. **Server L2 first** (Section 4) — highest leverage; makes the API safe regardless of client.
2. **P0 guards** (Section 7) — security posture.
3. **Client reactive-forms validation** (Section 3) — UX polish over the now-safe API.
4. **Business-rule gaps** (Section 5: capacity-on-edit, cancel-after-checkin, race, token expiry).
5. **P1/P2** hardening + tests.

Each item is independently shippable; none requires a data migration except token-expiry
fields (add `ExpiresAt`/`UsedAt` columns to `Invitation` and the user verification token).
