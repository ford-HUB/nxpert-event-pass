# Publishing to IIS (API and App on separate ports)

The API and the Angular app are deployed as **two independent IIS sites on the same server**,
each bound to its **own port**. Example ports used throughout this guide (change to suit):

| Site           | Serves               | HTTP port | HTTPS port | Example URL                  |
|----------------|----------------------|-----------|------------|------------------------------|
| **App** (FE)   | Angular static files | 8080      | 8443       | `https://SERVER:8443`        |
| **API** (BE)   | .NET Core Web API     | 5000      | 5001       | `https://SERVER:5001`        |

Replace `SERVER` with the machine's hostname or IP. Because the two run on different ports they
are **different origins**, so the browser applies CORS (the API already allows any origin — see
step 3).

> **HTTPS matters:** the QR scanner uses `getUserMedia`, which browsers only allow over HTTPS
> (or `localhost`). Give at least the **App** site an HTTPS binding; give the **API** one too so
> the SPA isn't making mixed-content calls.

---

## 0. One-time server prerequisites

On the IIS machine, install:

1. **IIS** with role features: *Static Content*, *Default Document*, and (recommended)
   *WebSocket Protocol*.
2. **URL Rewrite module** — <https://www.iis.net/downloads/microsoft/url-rewrite>
   (required for Angular deep-link routing).
3. **.NET 10 ASP.NET Core Hosting Bundle** — <https://dotnet.microsoft.com/download/dotnet/10.0>
   → "Hosting Bundle". Installs the runtime **and** the ASP.NET Core Module (ANCM) for IIS.
   Run `iisreset` after installing.
4. **SQL Server** reachable from the server — Express is fine. **LocalDB will not work under
   IIS** (per-user instance the app-pool identity can't start). See step 1.
5. Open the chosen ports (8080/8443/5000/5001) in **Windows Firewall** for inbound traffic.

---

## 1. Build & publish the backend (.NET Web API)

From `backend/EventRegistration.Api`:

```powershell
dotnet publish -c Release -o C:\inetpub\EventReg\api
```

Produces the publish folder including a generated **`web.config`** wired to ANCM (in-process).

### Production settings

Create **`appsettings.Production.json`** next to the DLL (and set `ASPNETCORE_ENVIRONMENT=Production`
in the site — below). Put real values there — never ship dev secrets:

```jsonc
{
  "ConnectionStrings": {
    // Real SQL Server — NOT LocalDB. Examples:
    //   "Server=.\\SQLEXPRESS;Database=EventRegistrationDb;Trusted_Connection=True;TrustServerCertificate=True"
    //   "Server=SQLHOST;Database=EventRegistrationDb;User Id=eventreg;Password=***;TrustServerCertificate=True"
    "Default": "Server=.\\SQLEXPRESS;Database=EventRegistrationDb;Trusted_Connection=True;TrustServerCertificate=True"
  },
  "Jwt": { "Key": "REPLACE-with-a-long-random-secret-at-least-32-chars" },
  "Email": {
    "Enabled": true,
    "User": "you@gmail.com",
    "Password": "gmail-app-password",
    "FromAddress": "you@gmail.com"
  },
  "App": {
    // PUBLIC URL of the App site, INCLUDING its port — invite links are built from this.
    "FrontendBaseUrl": "https://SERVER:8443",
    "RequireEmailVerification": false
  }
}
```

> The app runs EF Core migrations and seeds the admin/contacts/sample event **on startup**
> (`DbSeeder`). The SQL login must be able to **create the database** (or pre-create an empty
> `EventRegistrationDb` and grant `db_owner`).

### Create the API site on its own port

1. **App pool:** `EventRegApi`, **.NET CLR version = _No Managed Code_**, pipeline *Integrated*.
   If using `Trusted_Connection` to SQL, give the pool identity (`IIS AppPool\EventRegApi`) a SQL
   login, or run the pool as a domain/service account that has one.
2. **Site:** point at `C:\inetpub\EventReg\api`. Add bindings:
   - `http`, port **5000** (host name blank = all)
   - `https`, port **5001**, select your TLS certificate
3. **Environment:** set `ASPNETCORE_ENVIRONMENT=Production` — add it to the app pool's
   environment variables, or into the published `web.config`:
   ```xml
   <aspNetCore ...>
     <environmentVariables>
       <environmentVariable name="ASPNETCORE_ENVIRONMENT" value="Production" />
     </environmentVariables>
   </aspNetCore>
   ```
4. Verify: browse `https://SERVER:5001/` → `{"service":"EventRegistration.Api","status":"ok"}`.

> The API listens through IIS on these ports — leave the app's own Kestrel ports (the dev
> `launchSettings.json` 5088/7088) alone; they're ignored under IIS/ANCM.

---

## 2. Build & publish the frontend (Angular)

### Point the SPA at the API **before** building

`API_BASE` is compiled into the bundle. Edit
[`frontend/web/src/app/core/config.ts`](frontend/web/src/app/core/config.ts) to the API site's
public URL **including its port**:

```ts
export const API_BASE = 'https://SERVER:5001';
```

### Build

From `frontend/web`:

```powershell
npm ci
npm run build          # production ng build
```

Output lands in **`dist/web/browser`** (includes the `web.config` from `public/`).

### Create the App site on its own port

1. Copy the **contents of `dist/web/browser`** to `C:\inetpub\EventReg\web`.
2. Create a static site pointing there. Add bindings:
   - `http`, port **8080**
   - `https`, port **8443**, select your TLS certificate
3. The included `web.config` rewrites unknown paths to `index.html` (needs the **URL Rewrite**
   module), so `/scanner`, `/e/{slug}`, and `/verify/{token}` work on refresh/direct open.
4. Browse `https://SERVER:8443/` → the sign-in page.

---

## 3. Cross-cutting checklist

- **The two URLs must reference each other, with ports:**
  `API_BASE = https://SERVER:5001` (SPA) and `App:FrontendBaseUrl = https://SERVER:8443` (API).
  Get these wrong and API calls or invite links hit the wrong port.
- **CORS:** different port = different origin. The API currently allows **any** origin (dev
  convenience), so it works out of the box. For production, tighten it in `Program.cs`
  (`SetIsOriginAllowed`) to exactly `https://SERVER:8443`, then re-publish:
  ```csharp
  builder.Services.AddCors(o => o.AddDefaultPolicy(p => p
      .WithOrigins("https://SERVER:8443")
      .AllowAnyHeader().AllowAnyMethod()));
  ```
- **HTTPS / certificate:** use a cert whose name the phone trusts. A self-signed cert works for an
  internal demo only if installed as trusted on the scanning device; otherwise the camera page
  is blocked. Mixed content (HTTPS app → HTTP api) is also blocked — keep both on HTTPS.

---

## 4. Updating later

- **Backend:** `dotnet publish -c Release -o C:\inetpub\EventReg\api` again; overwrite. ANCM
  restarts on file change; `iisreset` if a DLL is locked.
- **Frontend:** re-run `npm run build`, replace the contents of `C:\inetpub\EventReg\web`
  (hashed filenames avoid stale-cache issues).
- Changed `API_BASE`? You **must rebuild** the frontend — it's baked into the bundle.
