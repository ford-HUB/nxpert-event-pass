---
name: run-local-demo
description: Run, reset, and demo the Event Registration app locally — start the API and Angular dev server, reseed the demo database, enable real Gmail email, scan from a phone via ngrok, and follow the 5-minute demo script. Use when asked to start, run, reset, or demo the app.
---

# Run the app locally (cmd / bash)

All commands below are plain **cmd** (Windows) or **bash** — no PowerShell required. Run from the
repo root. Behavioral rules live in `.claude/rules/demo-and-config.md`; permitted commands live in
`.claude/settings.json`.

## Prerequisites

- .NET SDK 10
- Node 20+ and npm
- SQL Server LocalDB — `sqllocaldb info` should list `MSSQLLocalDB`
- (Optional) [ngrok](https://ngrok.com) to scan from a real phone

## Start

**Backend** (creates + seeds the DB on first run; listens on http://localhost:5088):

```cmd
cd backend\EventRegistration.Api && dotnet run
```

**Frontend** (opens http://localhost:4200; `npm install` first time only):

```cmd
cd frontend\web && npm install && npm start
```

**Both at once** (replaces `start-demo.ps1` — two separate cmd windows):

```cmd
start "EventReg API" cmd /k "cd /d backend\EventRegistration.Api && dotnet run"
start "EventReg Web" cmd /k "cd /d frontend\web && npm start"
```

bash equivalent: run each in its own terminal (`cd backend/EventRegistration.Api && dotnet run`,
`cd frontend/web && npm start`). When both are up, open http://localhost:4200 and sign in as
`admin@demo.com` / `Admin123!`.

## Reset demo data

Do this before each rehearsal and the live demo. It drops the DB; the API re-creates and re-seeds
on next startup.

```cmd
cd backend\EventRegistration.Api && dotnet ef database drop --force
```

(Equivalent of `reseed.ps1`.)

## Email (invites + QR passes)

Email is **off by default**. While off, every message (including the QR pass PNG) is written to
`backend/EventRegistration.Api/outbox/` as `.html` + `.qr.png` so you can see exactly what would
have been sent.

To send real email via Gmail:

1. Enable 2-Step Verification on the Google account, then create an **App Password**
   (Google Account → Security → App passwords).
2. Set it in `appsettings.json` **locally only** (never commit it — see the security rules):

   ```json
   "Email": {
     "Enabled": true,
     "User": "your-gmail@gmail.com",
     "Password": "the-16-char-app-password",
     "FromAddress": "your-gmail@gmail.com"
   }
   ```
3. Restart the API and send a test invite. **Do this the day before the demo**, not on demo day —
   Gmail app passwords and burst limits are the usual surprise. Invites are throttled (~5/sec).

## Scanning from a real phone (ngrok)

The camera API (`getUserMedia`) needs HTTPS except on `localhost`. Expose both servers over HTTPS:

1. API tunnel: `ngrok http 5088` → copy the `https://…` URL.
2. Web tunnel: `ngrok http 4200` (second agent) → copy that URL.
3. Set `API_BASE` in `frontend/web/src/app/core/config.ts` to the **API** ngrok URL.
4. Set `App:FrontendBaseUrl` in `appsettings.json` to the **web** ngrok URL (invite links).
5. Open the web ngrok URL on the phone, sign in as admin → **Scanner** → allow camera.

> Same-machine shortcut: open the participant pass (**My Events → Show pass** or the registration
> success screen) and scan it off the screen with the admin Scanner on the laptop webcam.

## Demo script (~5 min)

1. Sign in as **admin** → **Q3 Product Seminar** → **Invite** tab → pick contacts → **Send
   invitations** (show the email: real inbox if Gmail is on, else the outbox).
2. Open the registration link (`/e/{slug}`) → enter a name (no account) → **Get my entry pass** →
   QR pass appears with **Download pass (PNG)**.
3. **Scanner** on the phone → scan the pass → big green **"Checked in"** banner with the name.
4. Back on the laptop → event's **Attendance** tab updates → **Export CSV**.
5. Close with the phase-2 roadmap: real email verification, event feedback, multi-company tenancy.

## Launch configs

`.claude/launch.json` defines `web` (port 4200) and `web-alt` (port 4300) for the Angular dev
server (`npm start --prefix frontend/web`).
