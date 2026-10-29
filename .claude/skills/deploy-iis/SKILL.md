---
name: deploy-iis
description: Publish the Event Registration app to IIS as two independent sites (Angular static app + .NET API) on separate ports — prerequisites, dotnet publish, production appsettings, app pool/site/bindings, API_BASE, CORS, HTTPS, and update procedure. Use when asked to deploy, publish, host on IIS, or update a deployed instance.
---

# Deploy to IIS (API and App on separate ports)

Two independent IIS sites on the same server, each on its own port. Example ports (change to
suit; replace `SERVER` with hostname/IP):

| Site         | Serves               | HTTP | HTTPS | Example URL            |
|--------------|----------------------|------|-------|------------------------|
| **App** (FE) | Angular static files | 8080 | 8443  | `https://SERVER:8443`  |
| **API** (BE) | .NET Web API         | 5000 | 5001  | `https://SERVER:5001`  |

Different ports = different origins → the browser applies CORS. Rules for this deployment are in
`.claude/rules/deployment.md`. The full original guide is in [reference.md](reference.md).

> **HTTPS matters:** the QR scanner (`getUserMedia`) only works over HTTPS or `localhost`. Give
> both sites an HTTPS binding (avoids mixed-content calls from the SPA).

## 0. One-time server prerequisites

1. **IIS** with *Static Content*, *Default Document*, and (recommended) *WebSocket Protocol*.
2. **URL Rewrite module** (required for Angular deep links).
3. **.NET 10 ASP.NET Core Hosting Bundle** (runtime + ANCM). Run `iisreset` after installing.
4. **SQL Server** reachable from the server (Express is fine). **LocalDB does not work under IIS.**
5. Open the chosen ports (8080/8443/5000/5001) in **Windows Firewall** inbound.

## 1. Backend (.NET Web API)

From `backend/EventRegistration.Api`:

```cmd
dotnet publish -c Release -o C:\inetpub\EventReg\api
```

Create `appsettings.Production.json` next to the DLL (real values, never dev secrets):

```jsonc
{
  "ConnectionStrings": {
    "Default": "Server=.\\SQLEXPRESS;Database=EventRegistrationDb;Trusted_Connection=True;TrustServerCertificate=True"
  },
  "Jwt": { "Key": "REPLACE-with-a-long-random-secret-at-least-32-chars" },
  "Email": { "Enabled": true, "User": "you@gmail.com", "Password": "gmail-app-password", "FromAddress": "you@gmail.com" },
  "App": {
    "FrontendBaseUrl": "https://SERVER:8443",   // public App URL incl. port — invite links use it
    "RequireEmailVerification": false
  }
}
```

The app runs EF migrations and seeds on startup (`DbSeeder`); the SQL login must be able to create
the DB (or pre-create an empty `EventRegistrationDb` and grant `db_owner`).

**API site:**

1. App pool `EventRegApi`: **.NET CLR version = No Managed Code**, pipeline *Integrated*. For
   `Trusted_Connection`, give `IIS AppPool\EventRegApi` a SQL login (or run as a service account).
2. Site → `C:\inetpub\EventReg\api`; bindings `http :5000`, `https :5001` (select TLS cert).
3. Set `ASPNETCORE_ENVIRONMENT=Production` (pool env vars or in `web.config` under
   `<aspNetCore><environmentVariables>`).
4. Verify: `https://SERVER:5001/` → `{"service":"EventRegistration.Api","status":"ok"}`.

Dev Kestrel ports (5088/7088 in `launchSettings.json`) are ignored under IIS.

## 2. Frontend (Angular)

`API_BASE` is compiled into the bundle — set it **before** building in
`frontend/web/src/app/core/config.ts`:

```ts
export const API_BASE = 'https://SERVER:5001';
```

From `frontend/web`:

```cmd
npm ci && npm run build
```

Output: `dist/web/browser` (includes `web.config` from `public/`).

**App site:** copy the *contents* of `dist/web/browser` to `C:\inetpub\EventReg\web`; static site
with bindings `http :8080`, `https :8443` (TLS cert). The `web.config` rewrites unknown paths to
`index.html` (needs URL Rewrite) so `/scanner`, `/e/{slug}`, `/verify/{token}` work on refresh.
Browse `https://SERVER:8443/` → sign-in page.

## 3. Cross-cutting checklist

- URLs must reference each other **with ports**: `API_BASE = https://SERVER:5001` (SPA) and
  `App:FrontendBaseUrl = https://SERVER:8443` (API).
- **CORS:** API currently allows any origin. For production tighten in `Program.cs` to exactly the
  App origin and republish:
  ```csharp
  builder.Services.AddCors(o => o.AddDefaultPolicy(p => p
      .WithOrigins("https://SERVER:8443")
      .AllowAnyHeader().AllowAnyMethod()));
  ```
- **Certificate:** must be trusted by the scanning phone (self-signed only if installed as
  trusted). Mixed content (HTTPS app → HTTP API) is blocked — keep both HTTPS.

## 4. Updating later

- **Backend:** re-run `dotnet publish -c Release -o C:\inetpub\EventReg\api` and overwrite. ANCM
  restarts on file change; `iisreset` if a DLL is locked.
- **Frontend:** re-run `npm run build`, replace contents of `C:\inetpub\EventReg\web` (hashed
  filenames avoid stale cache).
- Changed `API_BASE`? **Rebuild the frontend** — it is baked into the bundle.
