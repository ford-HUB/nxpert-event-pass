# Local demo & configuration rules

Source: `run-local-demo` skill.

- Use **cmd or bash** for all commands (no PowerShell scripts). Dev API: `http://localhost:5088`;
  dev web: `http://localhost:4200`.
- **Reset the DB before each rehearsal and the live demo:** `dotnet ef database drop --force` in
  `backend/EventRegistration.Api`; the API re-seeds on next start. Ask before running it.
- **Email is off by default** (messages go to `backend/EventRegistration.Api/outbox/`). Test real
  Gmail the **day before** a demo, never on demo day; invites throttle at ~5/sec.
- Real SMTP credentials go in local, uncommitted config only.
- Phone scanning needs HTTPS: tunnel API (`ngrok http 5088`) and web (`ngrok http 4200`), then set
  `API_BASE` (frontend) to the API URL and `App:FrontendBaseUrl` (backend) to the web URL.
- Email verification stays **off** for demos (`App:RequireEmailVerification: false`).
- Prerequisites: .NET SDK 10, Node 20+, SQL Server LocalDB (`sqllocaldb info` lists
  `MSSQLLocalDB`).
