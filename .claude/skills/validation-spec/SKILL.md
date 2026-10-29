---
name: validation-spec
description: Production-readiness validation specification for the Event Registration app — four validation layers, canonical field rules (name, email, password, phone, event fields, rating), per-screen client rules, DTO rules, business rules, open decisions, and P0/P1/P2 guards with status markers. Use when adding or reviewing any form, DTO, endpoint, or input handling.
---

# Validation Specification (skill)

Full spec with status tables (✅ in place · ⚠️ partial · ❌ missing): [reference.md](reference.md).
Enforceable rules distilled from it: `.claude/rules/validation.md`.

## Layers (server is authoritative)

| Layer | Where | Role |
|-------|-------|------|
| L1 Client | Angular forms | UX feedback only; never trusted |
| L2 API/DTO | `[ApiController]` + DataAnnotations/FluentValidation | Shape, length, format, range → `400` |
| L3 Business | Controllers/services | Capacity, closed, duplicates, ownership, invite-only → `403/409/422` |
| L4 Database | EF constraints/indexes | Unique indexes, max-length, FKs, non-null |

**Biggest known gap:** L2 is effectively absent (DTOs are plain records, no `ModelState`
inspection). Introduce it first.

## Workflow when adding/changing an input

1. Look up the field in the canonical rules (reference §2) — reuse, don't redefine.
2. Add the L2 DTO annotation and the L4 column limit; keep the L3 business check.
3. Add the client L1 check as UX only (prefer Reactive Forms + `mat-error`).
4. Return failures as RFC 7807 `ProblemDetails` with a field-keyed `errors` map.
5. Add a test for the rule.

## Reference map

| Topic | Section |
|-------|---------|
| Layers, standard error response | §1 |
| Canonical field rules | §2 |
| Screen-by-screen client rules (login, register, guest, event form, invite, feedback, scanner, verify) | §3 |
| DTO/server rules per request type | §4 |
| Business-rule validations and gaps (capacity race, cancel-after-check-in, token expiry) | §5 |
| Open product decisions | §6 |
| P0/P1/P2 production guards | §7 |
| Suggested implementation order | §8 |

## Implementation order

1. Server L2 → 2. P0 guards → 3. Client reactive-forms → 4. Business-rule gaps → 5. P1/P2 + tests.
Only token expiry needs a migration (`ExpiresAt`/`UsedAt` on `Invitation` and the user
verification token).
