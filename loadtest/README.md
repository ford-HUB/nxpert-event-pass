# Load tests — registration & event scanning

Dependency-free Node scripts (Node 18+, uses global `fetch`). They fire concurrent requests at a
**running** API and report throughput + latency percentiles.

> ⚠ **These create real data.** `register.mjs` inserts registrations; `scan.mjs` records check-ins.
> Run them against a **local or staging** instance you own — never a production server with real users.

## 0. Prereqs
- Start the API locally (it listens on `http://localhost:5088`).
- Have a **public event** (public registration enabled). Note its slug (the `/e/<slug>` value).
- For the scan test: an **admin bearer token**. Copy it from your logged-in browser session
  (DevTools → Application → Local Storage → your auth token), or from a login API response.

## 1. Registration load test
```bash
BASE=http://localhost:5088 SLUG=<event-slug> N=500 C=25 TOKENS_OUT=loadtest/tokens.txt \
  node loadtest/register.mjs
```
- `N` total requests, `C` concurrency. Each uses a unique Senate No. so every call creates a row.
- Writes the created (unconfirmed) registration tokens to `TOKENS_OUT` for the scan test.
- Limitation: an event with a **required image field** can't be auto-filled (those calls will fail).

## 2. Check-in / scanning load test
```bash
# Optional: confirm the registrations first (in the app) so tokens check in as "valid".
BASE=http://localhost:5088 JWT=<admin-token> TOKENS=loadtest/tokens.txt N=1000 C=40 \
  node loadtest/scan.mjs
```
- With real `TOKENS`: first hit per token records attendance (write path); repeats return `already`.
- Without `TOKENS`: random GUIDs exercise the auth + lookup + invalid-path only (no writes).

## Reading the results
- `throughput req/s` — sustained rate at the given concurrency.
- `p50/p90/p95/p99` latency (ms) — tail latency matters most; p99 spiking means contention.
- `http status` / `outcome` — watch for 429/5xx (server limits) or `auth-failed` (bad JWT).

## Tuning a run
Start small (`N=100 C=10`), then ramp `C` (10 → 25 → 50 → 100) and watch where p99 and error rate
climb — that knee is the app's practical concurrency ceiling on this machine/DB.

## Cleanup
Load-test registrations all share a Senate No. prefix `LT-<runid>-…`, names `Load Test N`, and
emails `lt+<runid>-…@example.com`, so they're easy to find and delete afterward.
