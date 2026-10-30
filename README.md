# Event Registration App

A working demo/prototype: an admin creates events and emails invites; participants
register and get an emailed QR pass; the admin scans passes on a phone to check people
in, then exports the attendance sheet.

**Stack:** Angular 21 + Angular Material (frontend) · .NET 10 Web API (backend) ·
SQL Server LocalDB · MailKit (Gmail SMTP) · QRCoder.

```
EventRegistration/
├── backend/EventRegistration.Api/   # .NET Web API (EF Core code-first, JWT, email, QR)
└── frontend/web/                     # Angular SPA
```

---

## Prerequisites

- .NET SDK 10
- Node 20+ and npm
- SQL Server LocalDB (`sqllocaldb info` should list `MSSQLLocalDB`)
- (Optional) [ngrok](https://ngrok.com) for scanning from a real phone

---

## Quick start

### 1. Backend

```powershell
cd backend/EventRegistration.Api
dotnet run
```

On first run it creates and seeds the database automatically, then listens on
**http://localhost:5088**.

Seeded accounts:

| Role        | Email             | Password    |
|-------------|-------------------|-------------|
| Admin       | `admin@demo.com`  | `Admin123!` |
| Participant | `alice@example.com` (and bob/carla/david/emma) | `Passw0rd!` |

Plus one event: **Q3 Product Seminar**.

### 2. Frontend

```powershell
cd frontend/web
npm install      # first time only
npm start
```

Opens on **http://localhost:4200**. Sign in with the admin account above.

---

## Email (invites + QR passes)

Email is **off by default** so the demo runs with zero setup. With email disabled,
every message (including the QR pass PNG) is written to
`backend/EventRegistration.Api/outbox/` as `.html` + `.qr.png` files so you can still
see exactly what would have been sent.

To send real email via Gmail:

1. Enable 2-Step Verification on the Google account, then create an
   **App Password** (Google Account → Security → App passwords).
2. Edit `backend/EventRegistration.Api/appsettings.json`:

   ```json
   "Email": {
     "Enabled": true,
     "User": "your-gmail@gmail.com",
     "Password": "the-16-char-app-password",
     "FromAddress": "your-gmail@gmail.com"
   }
   ```

3. Restart the API and send a test invite. **Do this the day before the demo, not on
   demo day** — Gmail app passwords and burst limits are the most common surprise.
   Invites are throttled (~5/sec) to stay well under Gmail's limits.

---

## Scheduled invitations and email history

In an event's **Invite** tab, compose the To/CC recipients, subject and message.
Choose **Schedule for later**, enter a future date/time in **Philippine time (UTC+8)**,
then click **Schedule invitations**. Leaving scheduling off sends immediately.
Full Gmail and company email addresses are supported in both To and CC. `@n-pax`
expands to the system directory when the email is saved; that recipient list stays fixed.

**Email history** below the composer provides **All emails**, **Scheduled** and **Sent**
filters, plus **Hide emails / Show emails**. Open a message to inspect its content,
recipients and dates. Scheduled, queued and failed messages can be edited or cancelled.
Sent messages are read-only and can be reused as a new draft. Concurrent changes are
checked before saving, and an email that has started sending cannot be changed.
History records composed emails from this feature's deployment onward; earlier
recipient invitation rows did not store message bodies and cannot be reconstructed.

Deploy the frontend and backend together. The `InvitationEmailHistory` migration is
applied by the existing `Database:AutoMigrate` startup setting (or apply it through
your normal database migration process if that setting is disabled).
Keep the API process running: its worker checks persisted schedules every 15 seconds,
including overdue messages after a restart. No browser needs to remain open.

Actual delivery requires working, enabled SMTP settings. Disabled/unavailable SMTP
saves an outbox copy and marks the message **Queued**, without a sent timestamp.
The worker retries every five minutes, up to five attempts; exhausted attempts show
**Failed** and can be opened to retry or reschedule. **Sent** means the SMTP server
accepted the email, rather than a guarantee of inbox placement. Interrupted sends
require manual review before retrying because delivery may already have occurred.

Run the database and mail-generation integration checks with:

```powershell
dotnet run --project backend/EventRegistration.EmailTests
```

These checks create and remove an isolated SQL Server LocalDB database and use a
simulated transport to inspect production MIME messages without emailing anyone.

---

## Scanning from a real phone (ngrok)

The camera API (`getUserMedia`) requires HTTPS, except on `localhost`. To scan from
your phone, expose both servers over HTTPS with ngrok:

1. Tunnel the **API**:  `ngrok http 5088`  → copy the `https://…` URL.
2. Tunnel the **web app**:  `ngrok http 4200` (a second tunnel/agent) → copy that URL.
3. Point the SPA at the API tunnel: edit
   `frontend/web/src/app/core/config.ts` and set `API_BASE` to the API's ngrok URL.
4. Set `App:FrontendBaseUrl` in `appsettings.json` to the web app's ngrok URL so
   invite links point at the right place.
5. Open the web ngrok URL on your phone, sign in as admin, go to **Scanner**, and
   allow camera access.

> Tip: for a quick same-machine demo you don't need a phone at all — open the
> participant's pass (**My Events → Show pass** or the registration success screen),
> then scan it off the screen with the admin Scanner on the same laptop's webcam.

---

## Reset demo data

Before each rehearsal and the live demo, reset to a clean seeded state:

```powershell
cd backend/EventRegistration.Api
./reseed.ps1        # drops the DB; the API re-seeds on next startup
```

---

## Demo script (~5 min)

1. Sign in as **admin** → open **Q3 Product Seminar** → **Invite** tab → pick contacts
   → **Send invitations** (show the email; real inbox if Gmail is on, else the outbox).
2. Open the registration link (`/e/{slug}`) → enter a name (no account) → **Get my entry
   pass** → the QR pass appears with a **Download pass (PNG)** button.
3. Go to **Scanner** on your phone → scan the pass → **big green "Checked in"** banner
   with the participant's name.
4. Back on the laptop → the event's **Attendance** tab updates → **Export CSV**.
5. Close with the phase-2 roadmap: real email verification, event feedback,
   multi-company tenancy.

---

## Registration via the public event link (`/e/{slug}`)

The link adapts to who opens it. Each emailed invitation carries a per-invitee **magic-link
token** (`/e/{slug}?invite={token}`):

- **Invited people who already have an account** are **auto-logged-in** the moment they open
  the link — no password prompt — then get the original flow: details auto-filled, one click
  to register, the pass emailed, and the event tracked under **My Events**.
- **Invited people without an account** get the **no-account guest flow** with their email
  prefilled: enter a name (email/phone optional) and immediately receive an entry pass. No
  signup, no password, **no system user is created**. The QR shows on-screen with a
  **Download pass (PNG)** button; if an email was given, a copy is emailed.
- Opening the plain link (no token) or as an anonymous visitor still shows the guest form,
  with a "Sign in" link for account holders who want the tracked flow.

> The invite token is passwordless login by possession of the emailed link — fine for a demo.
> Before real use, make these tokens single-use and time-limited.

The same QR check-in and attendance tracking work for guests and account-holders alike
(guests show their name + email-or-phone on the attendance sheet).

- Invite-only events (public link off) still require the guest to use the email their
  invitation was sent to.
- Repeat submissions with the same email or phone reuse the existing pass instead of
  creating duplicates.
- Account-based registration (seeded contacts, "My Events") still exists alongside this;
  those users can also **Download PNG** from the pass dialog.

## Extra features (built on top of the core flow)

- **Email verification (toggleable).** Off by default so the demo runs friction-free.
  Set `App:RequireEmailVerification: true` in `appsettings.json` to turn it on: new
  signups get a confirmation email, an in-app "please verify" banner appears, and
  registering for an event is blocked until they click the link (`/verify/{token}`).
  Seeded accounts are pre-verified.
- **Event feedback (1–5 stars + comment).** Participants rate events they registered
  for from **My Events → Rate** (one rating per person, editable). Admins see the
  average and every comment on the event's **Feedback** tab.
- **Admin dashboard.** Landing page with summary cards (total events, upcoming,
  registrations, checked-in + check-in rate) and recent events with attendance bars.
- **Resend pass / cancel registration.** Both live in the **My Events** card overflow
  menu (cancel is disabled once checked in).

## What's intentionally out of scope (phase 2)

Super-admin UI, full contacts CRUD, password reset/profile editing, multi-company
tenancy (tables already carry a nullable `CompanyId`), recurring events / capacity /
waitlists, and cloud deployment. See the project plan for the full list and the
post-demo hardening checklist (secrets management, tightened CORS, rate limiting,
unit tests, deployment).
