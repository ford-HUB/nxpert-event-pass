// Load test: public guest registration (POST /api/registrations/guest/{slug}).
// Dependency-free (Node 18+ global fetch). Creates REAL registrations in the target DB.
//
// Usage:
//   BASE=http://localhost:5088 SLUG=my-event N=500 C=25 node loadtest/register.mjs
//
// Env:
//   BASE  API base URL           (default http://localhost:5088)
//   SLUG  public event slug       (required — the event must have public registration enabled)
//   N     total requests          (default 200)
//   C     concurrency             (default 20)
//   TOKENS_OUT  file to write the created registration tokens to (optional; feeds scan.mjs)
//
// Each request uses a unique Senate No. (the dedup key) so every call creates a new registration.

import { writeFileSync } from 'node:fs';

const BASE = (process.env.BASE || 'http://localhost:5088').replace(/\/$/, '');
const SLUG = process.env.SLUG;
const N = parseInt(process.env.N || '200', 10);
const C = parseInt(process.env.C || '20', 10);
const TOKENS_OUT = process.env.TOKENS_OUT || '';
const RUN = Date.now().toString(36);

if (!SLUG) { console.error('SLUG is required (the public event slug).'); process.exit(1); }

// A valid value for each required field type, so the server's required-field check passes.
function fillField(f) {
  const opt = (f.options && f.options[0]) || 'Option 1';
  switch (f.type) {
    case 'select': case 'radio': return opt;
    case 'multiselect': return opt;
    case 'checkbox': return 'Yes';
    case 'number': return '1';
    case 'date': return '2026-01-01';
    case 'time': return '09:00';
    case 'image': return null; // can't synthesize an image answer — required image fields unsupported
    default: return 'LoadTest';
  }
}

// Build responses covering every currently-required field (respecting one-level radio conditions).
function buildResponses(fields) {
  const chosen = {};
  for (const f of fields) if (f.type === 'radio' || f.type === 'select') chosen[f.key] = fillField(f);
  const out = {};
  let unsupported = false;
  for (const f of fields) {
    if (!f.required) continue;
    if (f.showWhenField && chosen[f.showWhenField] !== f.showWhenValue) continue; // hidden → not required
    const v = fillField(f);
    if (v === null) { unsupported = true; continue; }
    out[f.key] = v;
  }
  // include the controllers too (harmless), so conditional required fields we filled stay visible
  for (const [k, v] of Object.entries(chosen)) if (v != null) out[k] ??= v;
  return { out, unsupported };
}

function pct(sorted, p) {
  if (sorted.length === 0) return 0;
  const i = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[i];
}

async function main() {
  const evRes = await fetch(`${BASE}/api/events/public/${SLUG}`);
  if (!evRes.ok) { console.error(`Could not load event '${SLUG}': HTTP ${evRes.status}`); process.exit(1); }
  const ev = await evRes.json();
  const fields = ev.formFields || [];
  const sessionIds = (ev.sessions || []).length ? [ev.sessions[0].id] : [];
  const { out: responses, unsupported } = buildResponses(fields);
  if (unsupported) console.warn('⚠ Event has a required IMAGE field — those cannot be auto-filled; registrations may be rejected.');

  console.log(`Target: ${BASE}  event="${ev.title}"  fields=${fields.length}  sessions=${(ev.sessions||[]).length}`);
  console.log(`Plan: N=${N} requests, C=${C} concurrent\n`);

  const latencies = [];
  const status = {};      // http status -> count
  const outcome = {};     // created / already / error message -> count
  const tokens = [];
  let done = 0, next = 0;
  const t0 = performance.now();

  async function worker() {
    while (true) {
      const i = next++;
      if (i >= N) return;
      const senate = `LT-${RUN}-${i}`;
      const body = {
        fullName: `Load Test ${i}`,
        senateNo: senate,
        email: `lt+${RUN}-${i}@example.com`,
        phone: '+639170000000',
        notificationChannel: 'Email',
        sessionIds,
        responses,
        face: null,
        displayPicture: null,
      };
      const s = performance.now();
      try {
        const r = await fetch(`${BASE}/api/registrations/guest/${SLUG}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        latencies.push(performance.now() - s);
        status[r.status] = (status[r.status] || 0) + 1;
        const j = await r.json().catch(() => ({}));
        if (r.ok) {
          outcome[j.created ? 'created' : 'already'] = (outcome[j.created ? 'created' : 'already'] || 0) + 1;
          if (j.editToken) { tokens.push(j.editToken); }
        } else {
          const m = (j.message || `HTTP ${r.status}`).slice(0, 60);
          outcome[m] = (outcome[m] || 0) + 1;
        }
      } catch (e) {
        latencies.push(performance.now() - s);
        outcome[`neterr: ${e.code || e.message}`.slice(0, 60)] = (outcome['neterr'] || 0) + 1;
      }
      if (++done % Math.max(1, Math.floor(N / 10)) === 0) process.stdout.write(`  ${done}/${N}\r`);
    }
  }

  await Promise.all(Array.from({ length: C }, worker));
  const wall = (performance.now() - t0) / 1000;
  latencies.sort((a, b) => a - b);
  const sum = latencies.reduce((a, b) => a + b, 0);

  console.log(`\n\n=== Registration load test ===`);
  console.log(`requests: ${N}   wall: ${wall.toFixed(2)}s   throughput: ${(N / wall).toFixed(1)} req/s`);
  console.log(`latency ms  avg=${(sum / latencies.length).toFixed(0)}  p50=${pct(latencies,50).toFixed(0)}  p90=${pct(latencies,90).toFixed(0)}  p95=${pct(latencies,95).toFixed(0)}  p99=${pct(latencies,99).toFixed(0)}  max=${latencies.at(-1).toFixed(0)}`);
  console.log(`http status:`, status);
  console.log(`outcome:`, outcome);

  if (TOKENS_OUT && tokens.length) {
    writeFileSync(TOKENS_OUT, tokens.join('\n'));
    console.log(`\nWrote ${tokens.length} registration tokens → ${TOKENS_OUT}`);
    console.log(`(These are UNCONFIRMED. Confirm them in the app to test 'valid' check-ins with scan.mjs.)`);
  }
}

main();
