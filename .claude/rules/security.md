# Security rules

Source: `security-assessment` skill. Apply to every change in `backend/` and `frontend/`.

- **Never commit secrets.** No JWT keys, SMTP/Gmail passwords, or connection strings with
  credentials in `appsettings.json`. Use env vars / user-secrets / a vault; keep local overrides in
  `appsettings.*.Local.json` (gitignored). Never paste a real secret into docs, skills, or chat.
- **Treat the committed JWT key and Gmail app password as compromised** — rotate/revoke before any
  exposure; they remain in git history.
- **Seed the demo admin (`admin@demo.com` / `Admin123!`) in Development only.** Never in
  Production.
- **CORS:** never reflect any origin together with credentials. Use `WithOrigins(<known SPA
  origin>)`; the app uses Bearer tokens, so omit `AllowCredentials`.
- **Invite / verification tokens:** must be single-use and time-limited. Do not fully authenticate
  from a link alone.
- **Passwords:** enforce policy server-side (min 8, letter + digit, not equal to email), not only in
  Angular.
- **Throttle** `/api/auth/*` (login, register, verify, invite) and guest registration; add
  lockout/backoff on failed logins. Rate-limit emails per address/IP.
- **Email templates:** HTML-encode every interpolated value (`ev.Title`, `Venue`, `Description`,
  names). Build URLs server-side only.
- **Transport:** enforce HTTPS (redirect + HSTS). Add CSP, `X-Content-Type-Options`,
  frame-ancestors, and `Referrer-Policy: no-referrer` where tokens appear in URLs.
- **Data access:** EF Core LINQ only — no `FromSqlRaw` / string-built SQL. No `innerHTML` /
  `[innerHTML]` / `bypassSecurityTrust*` with user data in the SPA.
- **Authorization:** keep `[Authorize(Roles=…)]` on admin endpoints and ownership checks on
  cancel/resend. Never bind `Role` from input.
- **Outbox** (`outbox/` dir of unencrypted emails and QR passes): disabled or protected in
  Production.
- **Register responses** must not reveal whether an email already exists.
- **Dependencies:** run `dotnet list package --vulnerable` and `npm audit`; patch on a schedule.
- **Do not run dynamic/attack tests** against a live instance without the user's explicit go-ahead.
