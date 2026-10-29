---
name: event-app-overview
description: Overview of the Event Registration / NXPass app — stack, repo layout, seeded demo accounts, registration-link behavior, built-in extras and phase-2 scope. Use when answering "what does this app do", orienting in the codebase, or before touching registration, invite, or check-in features.
---

# Event Registration App (NXPass) — Overview

A working demo/prototype: an admin creates events and emails invites; participants register and
get an emailed QR pass; the admin scans passes on a phone to check people in, then exports the
attendance sheet.

**Stack:** Angular 21 + Angular Material (frontend) · .NET 10 Web API (backend) ·
SQL Server LocalDB · MailKit (Gmail SMTP) · QRCoder.

```
EventRegistration/
├── backend/EventRegistration.Api/   # .NET Web API (EF Core code-first, JWT, email, QR)
└── frontend/web/                     # Angular SPA
```

## Seeded demo data (first run, Development only)

| Role        | Email                                          | Password    |
|-------------|------------------------------------------------|-------------|
| Admin       | `admin@demo.com`                               | `Admin123!` |
| Participant | `alice@example.com` (and bob/carla/david/emma) | `Passw0rd!` |

Plus one event: **Q3 Product Seminar**. These are demo credentials only — see
`.claude/rules/security.md` before any non-demo deployment.

## Registration via the public event link (`/e/{slug}`)

Each emailed invitation carries a per-invitee **magic-link token** (`/e/{slug}?invite={token}`):

- **Invited + has account** → auto-logged-in on opening the link; details auto-filled, one click
  to register, pass emailed, event tracked under **My Events**.
- **Invited, no account** → no-account **guest flow** with email prefilled: enter a name
  (email/phone optional) and immediately receive an entry pass. No signup, no password, **no
  system user is created**. QR shows on-screen with **Download pass (PNG)**; emailed if an email
  was given.
- **Plain link (no token) / anonymous** → guest form, with a "Sign in" link for account holders.
- **Invite-only events** (public link off) still require the guest to use the email the invitation
  was sent to.
- Repeat submissions with the same email or phone **reuse the existing pass** (no duplicates).
- Account-based registration (seeded contacts, "My Events") still exists alongside; those users
  can also **Download PNG** from the pass dialog.
- Guests appear on the attendance sheet with name + email-or-phone; QR check-in works the same
  for guests and account holders.

> The invite token is passwordless login by possession of the link — demo-only. Before real use,
> make tokens single-use and time-limited (see `security-assessment`, finding H-2).

## Extra features built on the core flow

- **Email verification (toggleable)** — off by default. `App:RequireEmailVerification: true` in
  `appsettings.json` enables it: signup confirmation email, in-app "please verify" banner,
  event registration blocked until the link (`/verify/{token}`) is clicked. Seeded accounts are
  pre-verified.
- **Event feedback (1–5 stars + comment)** — from **My Events → Rate** (one rating per person,
  editable). Admins see the average and every comment on the event's **Feedback** tab.
- **Admin dashboard** — summary cards (total events, upcoming, registrations, checked-in +
  check-in rate) and recent events with attendance bars.
- **Resend pass / cancel registration** — in the **My Events** card overflow menu (cancel is
  disabled once checked in).

## Intentionally out of scope (phase 2)

Super-admin UI, full contacts CRUD, password reset/profile editing, multi-company tenancy (tables
already carry a nullable `CompanyId`), recurring events / capacity / waitlists, cloud deployment,
and the post-demo hardening checklist (secrets management, tightened CORS, rate limiting, unit
tests, deployment).

## Where to go next

| Need | Skill |
|------|-------|
| Run / reset / demo the app locally, email, ngrok | `run-local-demo` |
| Publish to IIS | `deploy-iis` |
| Organizer (admin) workflows | `admin-guide` |
| Attendee workflows | `participant-guide` |
| What input is valid | `validation-spec` |
| Security findings and fixes | `security-assessment` |
