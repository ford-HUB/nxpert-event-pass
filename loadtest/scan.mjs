// Load test: event check-in / scanning (POST /api/checkin).
// Dependency-free (Node 18+ global fetch). This endpoint requires an ADMIN bearer token.
//
// Usage:
//   BASE=http://localhost:5088 JWT=<admin token> TOKENS=loadtest/tokens.txt N=1000 C=40 node loadtest/scan.mjs
//
// Env:
//   BASE    API base URL                       (default http://localhost:5088)
//   JWT     admin/superadmin bearer token       (required — copy from your logged-in session)
//   TOKENS  path to a file of QR/registration tokens, one per line (from register.mjs TOKENS_OUT)
//           If omitted, random GUIDs are used (tests the invalid-token + auth + lookup path only).
//   N       total requests                      (default = number of tokens, or 500 for random)
//   C       concurrency                         (default 40)
//
// NOTE: the first check-in of a confirmed token records attendance (write); repeats return "already".
// Unconfirmed tokens return "unconfirmed". Random GUIDs return "invalid".

import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

const BASE = (process.env.BASE || 'http://localhost:5088').replace(/\/$/, '');
const JWT = process.env.JWT;
const TOKENS = process.env.TOKENS || '';
const C = parseInt(process.env.C || '40', 10);

if (!JWT) { console.error('JWT is required (an admin/superadmin bearer token).'); process.exit(1); }

let pool = [];
if (TOKENS) {
  pool = readFileSync(TOKENS, 'utf8').split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  if (pool.length === 0) { console.error(`No tokens in ${TOKENS}`); process.exit(1); }
}
const RANDOM = pool.length === 0;
const N = parseInt(process.env.N || String(pool.length || 500), 10);

function pctl(sorted, p) {
  if (sorted.length === 0) return 0;
  const i = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[i];
}

async function main() {
  console.log(`Target: ${BASE}/api/checkin  mode=${RANDOM ? 'random GUIDs (invalid-path)' : `${pool.length} real tokens`}`);
  console.log(`Plan: N=${N} requests, C=${C} concurrent\n`);

  const latencies = [];
  const status = {};
  const outcome = {};
  let done = 0, next = 0;
  const t0 = performance.now();

  async function worker() {
    while (true) {
      const i = next++;
      if (i >= N) return;
      const token = RANDOM ? randomUUID() : pool[i % pool.length];
      const s = performance.now();
      try {
        const r = await fetch(`${BASE}/api/checkin`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${JWT}` },
          body: JSON.stringify({ token }),
        });
        latencies.push(performance.now() - s);
        status[r.status] = (status[r.status] || 0) + 1;
        if (r.status === 401 || r.status === 403) { outcome['auth-failed'] = (outcome['auth-failed'] || 0) + 1; }
        else { const j = await r.json().catch(() => ({})); const k = j.status || 'unknown'; outcome[k] = (outcome[k] || 0) + 1; }
      } catch (e) {
        latencies.push(performance.now() - s);
        outcome[`neterr`] = (outcome['neterr'] || 0) + 1;
      }
      if (++done % Math.max(1, Math.floor(N / 10)) === 0) process.stdout.write(`  ${done}/${N}\r`);
    }
  }

  await Promise.all(Array.from({ length: C }, worker));
  const wall = (performance.now() - t0) / 1000;
  latencies.sort((a, b) => a - b);
  const sum = latencies.reduce((a, b) => a + b, 0);

  console.log(`\n\n=== Check-in load test ===`);
  console.log(`requests: ${N}   wall: ${wall.toFixed(2)}s   throughput: ${(N / wall).toFixed(1)} req/s`);
  console.log(`latency ms  avg=${(sum / latencies.length).toFixed(0)}  p50=${pctl(latencies,50).toFixed(0)}  p90=${pctl(latencies,90).toFixed(0)}  p95=${pctl(latencies,95).toFixed(0)}  p99=${pctl(latencies,99).toFixed(0)}  max=${latencies.at(-1).toFixed(0)}`);
  console.log(`http status:`, status);
  console.log(`outcome:`, outcome);
  if (outcome['auth-failed']) console.log(`\n⚠ Auth failed — the JWT is missing/expired or not an admin token.`);
}

main();
