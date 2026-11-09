#!/usr/bin/env node
/**
 * HyphaeHub Community Edition — self-host end-to-end smoke test.
 *
 * Drives a running Community container through the whole cultivation lifecycle
 * exactly as the web app would: sign up, auto-provisioned farm, strain, a SOURCE
 * culture, split into grain jars, combine into a bulk tub, record a harvest, add
 * costs, then verify the batch cost/yield rollup is computed correctly.
 *
 * Usage:
 *   BASE_URL=http://localhost:8080 node scripts/e2e-selfhost.mjs
 *
 * Exits 0 if every check passes, 1 otherwise. No dependencies (uses global fetch).
 */

const BASE = (process.env.BASE_URL ?? 'http://localhost:8080').replace(/\/$/, '');
const ORIGIN = process.env.ORIGIN ?? BASE;

let passed = 0;
let failed = 0;
const failures = [];

function ok(name, extra = '') {
  passed++;
  console.log(`  ✓ ${name}${extra ? ` ${extra}` : ''}`);
}
function bad(name, detail) {
  failed++;
  failures.push(`${name}: ${detail}`);
  console.log(`  ✗ ${name}  — ${detail}`);
}
function assert(name, cond, detail = '') {
  if (cond) ok(name);
  else bad(name, detail || 'assertion failed');
}

let token = null;

async function call(method, path, body, { auth = true, workspace = null, raw = false } = {}) {
  const headers = { origin: ORIGIN };
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (auth && token) headers.authorization = `Bearer ${token}`;
  if (workspace) headers['x-workspace-id'] = workspace;
  const res = await fetch(BASE + path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (raw) return { res, data, text };
  return { status: res.status, ok: res.ok, data, headers: res.headers };
}

async function waitForHealth(timeoutMs = 60000) {
  const start = Date.now();
  let lastErr = '';
  while (Date.now() - start < timeoutMs) {
    try {
      const r = await fetch(BASE + '/health');
      if (r.ok) return true;
      lastErr = `status ${r.status}`;
    } catch (e) {
      lastErr = e.message;
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`server never became healthy at ${BASE}/health (${lastErr})`);
}

function round(n, p = 2) {
  const f = 10 ** p;
  return Math.round(n * f) / f;
}

async function main() {
  console.log(`\nHyphaeHub self-host E2E  →  ${BASE}\n`);

  // ── 0. Health & readiness ────────────────────────────────────────────────
  console.log('Boot & public endpoints');
  await waitForHealth();
  {
    const h = await call('GET', '/health', undefined, { auth: false });
    assert('GET /health is ok', h.ok && h.data?.ok === true, `got ${h.status} ${JSON.stringify(h.data)}`);

    const cfg = await call('GET', '/api/config', undefined, { auth: false });
    assert(
      'GET /api/config advertises email/password',
      cfg.ok && cfg.data?.emailPasswordEnabled === true,
      `got ${cfg.status} ${JSON.stringify(cfg.data)}`,
    );

    // SPA served on the same origin.
    const root = await call('GET', '/', undefined, { auth: false, raw: true });
    const html = root.text ?? '';
    assert(
      'GET / serves the web SPA (index.html)',
      root.res.ok && /<div id="root"><\/div>|<title>|<script/i.test(html),
      `status ${root.res.status}, len ${html.length}`,
    );

    // Unauthenticated API call is rejected.
    const unauth = await call('GET', '/api/me', undefined, { auth: false });
    assert('GET /api/me without auth → 401', unauth.status === 401, `got ${unauth.status}`);
  }

  // ── 1. Sign up (auto-provisions a farm) ──────────────────────────────────
  console.log('\nAuth & workspace provisioning');
  const email = `e2e+${Date.now()}@example.com`;
  const password = 'correct-horse-battery-staple';
  {
    const su = await call(
      'POST',
      '/api/auth/sign-up/email',
      { email, password, name: 'E2E Grower' },
      { auth: false, raw: true },
    );
    token = su.data?.token || su.res.headers.get('set-auth-token') || null;
    assert(
      'POST /api/auth/sign-up/email succeeds',
      su.res.ok && !!su.data?.user,
      `status ${su.res.status} ${su.text?.slice(0, 200)}`,
    );
    assert('sign-up returns a session token', !!token, 'no token in body or set-auth-token header');
  }

  let workspaceId = null;
  {
    const me = await call('GET', '/api/me');
    assert('GET /api/me returns the user', me.ok && me.data?.user?.email === email, `got ${me.status} ${JSON.stringify(me.data)?.slice(0, 200)}`);
    assert('a farm was auto-created', !!me.data?.workspace?.id, 'no workspace on /api/me');
    assert('default plan is FREE', me.data?.plan === 'FREE', `plan=${me.data?.plan}`);
    assert('owner role on own farm', me.data?.role === 'OWNER', `role=${me.data?.role}`);
    assert('forecast + costs features default on', me.data?.features?.forecast === true && me.data?.features?.costs === true, JSON.stringify(me.data?.features));
    workspaceId = me.data?.workspace?.id ?? null;
  }
  const ws = () => ({ workspace: workspaceId });

  // ── 2. Strain ────────────────────────────────────────────────────────────
  console.log('\nLineage: strain → source → grain → bulk → harvest');
  let strainId = null;
  {
    const s = await call('POST', '/api/strains', { commonName: 'Blue Oyster', species: 'Pleurotus ostreatus', category: 'GOURMET' }, ws());
    assert('create strain', s.status === 201 || s.status === 200, `got ${s.status} ${JSON.stringify(s.data)?.slice(0,200)}`);
    strainId = s.data?.id ?? null;
    assert('strain has an id', !!strainId, JSON.stringify(s.data)?.slice(0, 200));
  }

  // ── 3. Batch (cost/yield anchor) ─────────────────────────────────────────
  let batchId = null;
  {
    const b = await call('POST', '/api/batches', { name: 'E2E Run #1', strainId, goalDryWeightG: 100 }, ws());
    assert('create batch', b.status === 201 || b.status === 200, `got ${b.status} ${JSON.stringify(b.data)?.slice(0,200)}`);
    batchId = b.data?.id ?? null;
    assert('batch has an id', !!batchId, JSON.stringify(b.data)?.slice(0, 200));
  }

  // ── 4. SOURCE culture ────────────────────────────────────────────────────
  let sourceId = null;
  {
    const c = await call(
      'POST',
      '/api/cultures',
      { type: 'SOURCE', label: 'LC-1', batchId, strainId, sourceType: 'LIQUID_CULTURE', status: 'INOCULATED' },
      ws(),
    );
    assert('create SOURCE culture', c.status === 201, `got ${c.status} ${JSON.stringify(c.data)?.slice(0,200)}`);
    sourceId = c.data?.id ?? null;
    assert('source has an id', !!sourceId, JSON.stringify(c.data)?.slice(0, 200));
  }

  // ── 5. Split SOURCE → 4 grain jars @ 250¢ each ────────────────────────────
  let grainIds = [];
  {
    const split = await call(
      'POST',
      `/api/cultures/${sourceId}/split`,
      { count: 4, type: 'GRAIN', containerType: 'JAR', substrateType: 'Rye', costPerChildCents: 250 },
      ws(),
    );
    assert('split source into 4 grain jars', split.status === 201, `got ${split.status} ${JSON.stringify(split.data)?.slice(0,200)}`);
    grainIds = (split.data?.children ?? []).map((ch) => ch.id);
    assert('4 grain children created', grainIds.length === 4, `got ${grainIds.length}`);
    assert('children are GRAIN type', (split.data?.children ?? []).every((ch) => ch.type === 'GRAIN'), 'non-grain child present');
  }

  // ── 6. Combine grain jars → BULK tub (1200g dry substrate, 1500¢) ──────────
  let tubId = null;
  {
    const combine = await call(
      'POST',
      '/api/cultures/combine',
      {
        parentIds: grainIds,
        label: 'Monotub A',
        type: 'BULK',
        containerType: 'MONOTUB',
        substrateType: 'CVG',
        drySubstrateG: 1200,
        batchId,
        substrateCostCents: 1500,
      },
      ws(),
    );
    assert('combine jars into a bulk tub', combine.status === 201, `got ${combine.status} ${JSON.stringify(combine.data)?.slice(0,200)}`);
    tubId = combine.data?.tub?.id ?? null;
    assert('tub has an id', !!tubId, JSON.stringify(combine.data)?.slice(0, 200));
  }

  // Verify lineage edges: tub has 4 parents.
  {
    const detail = await call('GET', `/api/cultures/${tubId}`, undefined, ws());
    assert('tub detail loads', detail.ok, `got ${detail.status}`);
    assert('tub records 4 parents in lineage', (detail.data?.parents ?? []).length === 4, `parents=${(detail.data?.parents ?? []).length}`);
  }

  // ── 7. Harvest the tub: 900g wet → 90g dry ───────────────────────────────
  {
    const h = await call(
      'POST',
      '/api/harvests',
      { cultureId: tubId, batchId, flushNumber: 1, wetWeightG: 900, dryWeightG: 90, harvestedAt: new Date().toISOString() },
      ws(),
    );
    assert('record a harvest', h.status === 201 || h.status === 200, `got ${h.status} ${JSON.stringify(h.data)?.slice(0,200)}`);
  }

  // ── 8. One more cost entry: EQUIPMENT 500¢ ──────────────────────────────
  {
    const cost = await call(
      'POST',
      '/api/costs',
      { description: 'Grow tent share', category: 'EQUIPMENT', amountCents: 500, batchId },
      ws(),
    );
    assert('add an equipment cost entry', cost.status === 201 || cost.status === 200, `got ${cost.status} ${JSON.stringify(cost.data)?.slice(0,200)}`);
  }

  // ── 9. Verify the batch cost/yield rollup ────────────────────────────────
  console.log('\nCost / yield engine rollup');
  // Expected costs: 4×250 (grain) + 1500 (substrate) + 500 (equipment) = 3000¢
  // Yield: 900g wet, 90g dry → dryRatio 0.1
  // costPerDryGram = 3000/90 = 33.33¢ ; costPerWetGram = 3000/900 = 3.33¢
  // biologicalEfficiency = 900/1200*100 = 75.0
  {
    const d = await call('GET', `/api/batches/${batchId}`, undefined, ws());
    assert('batch detail loads', d.ok, `got ${d.status}`);
    const s = d.data?.summary;
    assert('total cost = 3000¢', s?.cost?.totalCents === 3000, `got ${s?.cost?.totalCents}`);
    assert('total wet yield = 900g', s?.yield?.totalWetG === 900, `got ${s?.yield?.totalWetG}`);
    assert('total dry yield = 90g', s?.yield?.totalDryG === 90, `got ${s?.yield?.totalDryG}`);
    assert('dry ratio = 0.1', s?.yield?.dryRatio === 0.1, `got ${s?.yield?.dryRatio}`);
    assert('biological efficiency = 75%', s?.efficiency?.biologicalEfficiency === 75, `got ${s?.efficiency?.biologicalEfficiency}`);
    assert('cost per dry gram = 33.33¢', round(s?.efficiency?.costPerDryGramCents) === 33.33, `got ${s?.efficiency?.costPerDryGramCents}`);
    assert('cost per wet gram = 3.33¢', round(s?.efficiency?.costPerWetGramCents) === 3.33, `got ${s?.efficiency?.costPerWetGramCents}`);
    assert('batch bundles its cultures', (d.data?.cultures ?? []).length >= 6, `cultures=${(d.data?.cultures ?? []).length}`);
  }

  // ── 10. Forecast feature works end-to-end ────────────────────────────────
  console.log('\nForecast & isolation');
  {
    const f = await call('GET', `/api/forecast/batch/${batchId}`, undefined, ws());
    assert('GET /api/forecast/batch/:id works', f.ok, `got ${f.status} ${JSON.stringify(f.data)?.slice(0,150)}`);
  }

  // ── 11. Multi-tenant isolation: a second user cannot see tenant 1's data ──
  {
    const prevToken = token;
    const email2 = `e2e2+${Date.now()}@example.com`;
    const su2 = await call('POST', '/api/auth/sign-up/email', { email: email2, password, name: 'Other Grower' }, { auth: false, raw: true });
    token = su2.data?.token || su2.res.headers.get('set-auth-token') || null;
    const b2 = await call('GET', '/api/batches');
    assert("second user's batch list is empty (tenant isolation)", Array.isArray(b2.data) && b2.data.length === 0, `got ${JSON.stringify(b2.data)?.slice(0,120)}`);
    const steal = await call('GET', `/api/batches/${batchId}`);
    assert("second user cannot read tenant 1's batch → 404", steal.status === 404, `got ${steal.status}`);
    token = prevToken;
  }

  // ── 12. Cloud Connect: the official cloud app talks to this self-host ─────
  // The official web app (https://app.hyphaehub.io) and mobile app connect to a
  // self-hosted instance cross-origin with a bearer token (cookies cannot cross
  // origins). Here we act exactly as that cloud app would.
  console.log('\nCloud Connect (official cloud origin → self-host, cross-origin bearer)');
  const CLOUD_ORIGIN = 'https://app.hyphaehub.io';
  {
    // Browser preflight for a credentialed cross-origin POST (sign-in/up).
    const pre = await fetch(BASE + '/api/auth/sign-up/email', {
      method: 'OPTIONS',
      headers: {
        origin: CLOUD_ORIGIN,
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'content-type,authorization',
      },
    });
    assert(
      'CORS preflight allows the official cloud origin',
      pre.headers.get('access-control-allow-origin') === CLOUD_ORIGIN,
      `allow-origin=${pre.headers.get('access-control-allow-origin')}`,
    );
    assert(
      'CORS allows credentials',
      pre.headers.get('access-control-allow-credentials') === 'true',
      `allow-credentials=${pre.headers.get('access-control-allow-credentials')}`,
    );

    // Sign up from the cloud origin and read the bearer token the cloud app uses.
    const emailC = `connect+${Date.now()}@example.com`;
    const su = await fetch(BASE + '/api/auth/sign-up/email', {
      method: 'POST',
      headers: { origin: CLOUD_ORIGIN, 'content-type': 'application/json' },
      body: JSON.stringify({ email: emailC, password, name: 'Cloud User' }),
    });
    const suBody = await su.json().catch(() => null);
    const cToken = suBody?.token || su.headers.get('set-auth-token') || null;
    assert(
      'cloud origin can sign up (trusted origin, no CSRF block)',
      su.ok && !!suBody?.user,
      `status ${su.status}`,
    );
    assert(
      'bearer token is exposed cross-origin (set-auth-token in expose-headers)',
      (su.headers.get('access-control-expose-headers') || '').toLowerCase().includes('set-auth-token'),
      `expose-headers=${su.headers.get('access-control-expose-headers')}`,
    );
    assert('cloud sign-up returns a bearer token for connect mode', !!cToken, 'no token in body or header');

    // Drive the full app cross-origin with ONLY the bearer token (no cookies).
    const cc = async (method, path, body) => {
      const headers = { origin: CLOUD_ORIGIN, authorization: `Bearer ${cToken}` };
      if (body !== undefined) headers['content-type'] = 'application/json';
      const res = await fetch(BASE + path, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const t = await res.text();
      let d = null;
      try {
        d = t ? JSON.parse(t) : null;
      } catch {
        d = t;
      }
      return {
        status: res.status,
        ok: res.ok,
        data: d,
        acao: res.headers.get('access-control-allow-origin'),
      };
    };

    const meC = await cc('GET', '/api/me');
    assert(
      'cloud app reads the account cross-origin',
      meC.ok && meC.data?.user?.email === emailC,
      `status ${meC.status}`,
    );
    assert('response is scoped to the cloud origin', meC.acao === CLOUD_ORIGIN, `allow-origin=${meC.acao}`);

    const stc = await cc('POST', '/api/strains', { commonName: "Lion's Mane", category: 'FUNCTIONAL' });
    assert(
      'cloud app can create data cross-origin',
      stc.status === 201 || stc.status === 200,
      `status ${stc.status}`,
    );
    const bc = await cc('POST', '/api/batches', { name: 'Connect Run' });
    assert(
      'cloud app can create a batch cross-origin',
      bc.status === 201 || bc.status === 200,
      `status ${bc.status}`,
    );
    const listc = await cc('GET', '/api/batches');
    assert(
      'cloud app reads its data back cross-origin',
      Array.isArray(listc.data) && listc.data.length >= 1,
      `got ${JSON.stringify(listc.data)?.slice(0, 80)}`,
    );

    // Public auto-refreshing calendar feed (what Google/Apple subscribe to).
    const sub = await cc('POST', '/api/forecast/subscription');
    const icsPath = sub.data?.path;
    assert('cloud app can mint a public calendar subscription', !!icsPath, `${JSON.stringify(sub.data)?.slice(0, 80)}`);
    if (icsPath) {
      const icsRes = await fetch(BASE + icsPath);
      const icsBody = await icsRes.text();
      assert(
        'public .ics feed serves calendar data (no auth)',
        icsRes.ok && /BEGIN:VCALENDAR/i.test(icsBody),
        `status ${icsRes.status}`,
      );
    }
  }

  // ── 13. An untrusted origin is NOT granted cross-origin access ────────────
  {
    const evil = 'https://not-trusted.example.com';
    const r = await fetch(BASE + '/api/me', { headers: { origin: evil } });
    assert(
      'untrusted origin is not reflected by CORS',
      r.headers.get('access-control-allow-origin') !== evil,
      `allow-origin=${r.headers.get('access-control-allow-origin')}`,
    );
  }

  // ── Summary ──────────────────────────────────────────────────────────────
  console.log(`\n${'─'.repeat(48)}`);
  console.log(`  ${passed} passed, ${failed} failed`);
  if (failed) {
    console.log('\nFailures:');
    for (const f of failures) console.log(`  • ${f}`);
  }
  console.log('');
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error('\nE2E crashed:', e?.stack || e);
  process.exit(1);
});
