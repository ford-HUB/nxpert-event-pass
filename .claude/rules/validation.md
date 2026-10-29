# Validation rules

Source: `validation-spec` skill. The server is authoritative; the client is UX only.

## Where to enforce

- Every request DTO gets L2 annotations (`[ApiController]` auto-400); keep L3 business checks;
  match L4 EF `[MaxLength]` to the limits below.
- Return failures as RFC 7807 `ProblemDetails` with an `errors` map. Never leak stack traces.
- Trim all strings, reject control chars, cap request body (~256 KB), HTML-encode on display.

## Canonical field rules

| Field | Rule |
|-------|------|
| Name | Required, trimmed, 2–200 chars, not whitespace-only |
| Email | Trimmed, lower-cased, RFC 5322 format, ≤ 256 |
| Password | 8–128 chars, ≥ 1 letter and ≥ 1 digit, not equal to email |
| Phone | Optional, 7–40 chars, `^[0-9+()\-\s]+$`, ≥ 7 digits |
| Organization | Optional, ≤ 200 |
| Event title | Required, trimmed, 3–300 |
| Description | Optional, ≤ 4000 |
| Venue | Required, trimmed, ≤ 300 |
| Start / End | Both required; **End > Start**; new events Start ≥ today (warn, don't block, when editing past events) |
| Capacity | Blank = unlimited, else integer ≥ 1; on edit ≥ current registration count |
| Status | `Draft` \| `Published` \| `Closed` |
| Rating | Integer 1–5 |
| Feedback comment | Optional, ≤ 1000 |
| Token / slug | Tokens parse as GUID; slug `^[a-z0-9-]{1,100}$` |

## Per-request rules

- `GuestRegisterRequest`: name required; email format if present; phone pattern if present; **email
  or phone required** (pending product sign-off).
- `InviteRequest`: non-empty, each a valid email, ≤ 200 items, de-duplicated server-side.
- `CheckInRequest`: token must parse as GUID; invalid scans return `invalid`, never crash.
- Route params constrained (`{id:int}`), tokens GUID-parsed.

## Business rules that must hold

- Closed or full events refuse registration; capacity check must be atomic (transaction/guard).
- Invite-only events accept only the invited email.
- Duplicate email/phone registration reuses the existing pass.
- Cancel is blocked after check-in **on the server**, not just the UI.
- Feedback only from a registered attendee, one per user/event.
- Login failure message is generic (no user enumeration).
- Verification and invite tokens expire and are single-use.
