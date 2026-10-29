---
name: admin-guide
description: NXPass administrator/organizer guide — events, sub-events, meal stubs, custom registration forms, online/hybrid events, Attendance (confirm/check-in/cancel), kit claiming, users and roles, CSV import, settings, scanner, offline check-in, merchant meal-stub scanner. Use when answering organizer how-to questions or changing admin-facing features.
---

# NXPass — Administrator Guide (skill)

Full guide: [reference.md](reference.md). Rules that must stay true when changing these features:
`.claude/rules/registration-flow.md`.

## Key model to remember

- Registrations start **Pending**; **no pass is sent**. An admin (or a user with **Can confirm
  registrations**) confirms → then the QR pass (and, for online events, meeting link + calendar
  invite; plus meal stubs) is sent. Only **confirmed** passes can be checked in.
- An event shows in *Browse Events* only when **Published** *and* the public link is on.
- Formats: **In person** (venue), **Online** (meeting link, no QR/stubs), **Hybrid** (both).
- Sub-events = separate registration + pass + confirmation + check-in each.

## Where to find things in the reference

| Topic | Section |
|-------|---------|
| Home, notifications, install-as-app | §1 |
| Dashboard KPIs | §2 |
| Events list, start check-in | §3 |
| Create/edit event: banner, format, status, capacity, public vs invite-only, sub-events, meal stubs, schedule, custom form fields | §4 |
| Online / hybrid, calendar invites, auto-updates | §5 |
| Event detail tabs: Invite, Attendance, Kit Claiming, Meal Stubs, Feedback; Viber blast | §6 |
| Users, roles, import CSV (up to 5,000 rows), facial registration | §7 |
| Settings (email CC, Viber/SMS) | §8 |
| Scanner modes, results banners, face tips, TV mode, offline check-in | §9 |
| Merchant meal-stub scanner | §10 |
| Quick answers (FAQ table) | Appendix |

## Roles at a glance

| Role | Can do |
|------|--------|
| Admin | Everything |
| Participant | Browse/register, My Events, My Account |
| Participant + Can confirm registrations | Also Attendance: confirm, check in, cancel pending, Viber blast. Not create/edit events, invite, scan, or manage users |
| Merchant | Meal Stub Scanner only |

A grant change applies at the user's **next sign-in**.

## Common task recipes

- **Someone got no pass** → event → **Attendance** → select pending rows → **Confirm selected**.
- **Scanner says "Not confirmed"** → confirm on Attendance, scan again.
- **Stop new sign-ups** → **Close** on the event page (Status = Closed).
- **Attendee list** → Attendance → **Export CSV**.
- **Bulk-add users** → Users → **Import** → Download template → fill → import (new accounts get
  default password `12345`; ask users to change it).
- **Camera won't open** → site must be served over HTTPS (or localhost).

Demo admin login: `admin@demo.com` / `Admin123!` (demo seed only).
