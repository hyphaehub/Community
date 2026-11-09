#!/usr/bin/env node
/**
 * HyphaeHub — anonymous self-host telemetry e2e.
 *
 * Validates the whole loop: the instance pings itself on boot (we start it with
 * HYPHAEHUB_TELEMETRY_URL pointed at its own /api/telemetry), the public endpoint
 * upserts one row per install id, and the platform admin can read install counts.
 * Also checks idempotency, validation, public access, and the admin role gate.
 *
 * Start the instance with SUPER_ADMIN_EMAIL=ADMIN_EMAIL and
 * HYPHAEHUB_TELEMETRY_URL=http://localhost:8080/api/telemetry.
 *
 *   BASE_URL=http://localhost:8080 node scripts/e2e-telemetry.mjs
 */

const BASE = (process.env.BASE_URL ?? 'http://localhost:8080').replace(/\/$/, '');
const ORIGIN = process.env.ORIGIN ?? BASE;
const ADMIN_EMAIL = process.env.ADMIN_EMAIL ?? 'admin@hyphae.test';
const PASSWORD = 'correct-horse-battery-staple';

let passed = 0;
let failed = 0;
const failures = [];
function assert(name, cond, detail = '') {
  if (cond) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failed++;
    failures.push(`${name}: ${detail}`);
    console.log(`  ✗ ${name}  — ${detail}`);
  }
}

async function raw(method, path, { token, body } = {}) {
  const headers = { origin: ORIGIN };
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (token) headers.authorization = `Bearer ${token}`;
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
  return { status: res.status, ok: res.ok, data };
}

async function signUpOrIn(email) {
  const su = await fetch(`${BASE}/api/auth/sign-up/email`, {
    method: 'POST',
    headers: { origin: ORIGIN, 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: PASSWORD, name: email.split('@')[0] }),
  });
  if (su.ok) {
    const b = await su.json().catch(() => null);
    return b?.token || su.headers.get('set-auth-token');
  }
  const si = await fetch(`${BASE}/api/auth/sign-in/email`, {
    method: 'POST',
    headers: { origin: ORIGIN, 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: PASSWORD }),
  });
  const b = await si.json().catch(() => null);
  return b?.token || si.headers.get('set-auth-token');
}

async function waitForHealth(timeoutMs = 60000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      if ((await fetch(`${BASE}/health`)).ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`server never healthy at ${BASE}/health`);
}

async function main() {
  console.log(`\nSelf-host telemetry  →  ${BASE}\n`);
  await waitForHealth();

  console.log('Accounts');
  const adminToken = await signUpOrIn(ADMIN_EMAIL);
  assert('super admin signs in', !!adminToken, 'no admin token');
  const me = await raw('GET', '/api/me', { token: adminToken });
  assert(
    'super admin is recognized',
    me.data?.isSuperAdmin === true,
    `isSuperAdmin=${me.data?.isSuperAdmin} (is SUPER_ADMIN_EMAIL=${ADMIN_EMAIL} set?)`,
  );

  // ── The instance pinged itself on boot ───────────────────────────────────
  console.log('\nBoot self-ping');
  let listed = { data: { total: 0 } };
  for (let i = 0; i < 10; i++) {
    listed = await raw('GET', '/api/admin/installs', { token: adminToken });
    if ((listed.data?.total ?? 0) >= 1) break;
    await new Promise((r) => setTimeout(r, 1000));
  }
  assert(
    'admin can read install counts',
    listed.ok && typeof listed.data?.total === 'number',
    `status ${listed.status}`,
  );
  assert(
    'the instance recorded its own boot ping',
    (listed.data?.total ?? 0) >= 1,
    `total=${listed.data?.total}`,
  );
  assert(
    'boot ping is counted active (7d)',
    (listed.data?.active7 ?? 0) >= 1,
    `active7=${listed.data?.active7}`,
  );
  const bootInstall = (listed.data?.installs ?? [])[0];
  assert(
    'recorded install has a version',
    !!bootInstall?.version,
    `version=${bootInstall?.version}`,
  );
  const baseTotal = listed.data.total;

  // ── Public, unauthenticated ping ─────────────────────────────────────────
  console.log('\nPublic ping endpoint');
  const id1 = `e2e-install-${Date.now()}`;
  const ping1 = await raw('POST', '/api/telemetry', { body: { installId: id1, version: '9.9.9' } });
  assert(
    'anyone can POST a ping (no auth)',
    ping1.ok && ping1.data?.ok === true,
    `status ${ping1.status}`,
  );
  const bad = await raw('POST', '/api/telemetry', { body: { installId: 'short' } });
  assert('a too-short install id is rejected (400)', bad.status === 400, `status ${bad.status}`);

  const afterPing = await raw('GET', '/api/admin/installs', { token: adminToken });
  assert(
    'new install appears in the registry',
    (afterPing.data?.total ?? 0) === baseTotal + 1,
    `got ${afterPing.data?.total} expected ${baseTotal + 1}`,
  );
  const mine = (afterPing.data?.installs ?? []).find((x) => x.installId === id1);
  assert(
    'new install is listed with its version',
    mine?.version === '9.9.9' && mine?.pingCount === 1,
    `${JSON.stringify(mine)?.slice(0, 100)}`,
  );

  // ── Idempotency: re-ping the same id ─────────────────────────────────────
  console.log('\nRepeat ping (idempotent by install id)');
  await raw('POST', '/api/telemetry', { body: { installId: id1, version: '9.9.10' } });
  const afterRe = await raw('GET', '/api/admin/installs', { token: adminToken });
  assert(
    're-ping does not create a duplicate',
    (afterRe.data?.total ?? 0) === baseTotal + 1,
    `got ${afterRe.data?.total}`,
  );
  const mine2 = (afterRe.data?.installs ?? []).find((x) => x.installId === id1);
  assert(
    're-ping bumps pingCount and version',
    mine2?.pingCount === 2 && mine2?.version === '9.9.10',
    `${JSON.stringify(mine2)?.slice(0, 100)}`,
  );

  // ── Admin gate ───────────────────────────────────────────────────────────
  console.log('\nAccess control');
  const userToken = await signUpOrIn(`tele-user+${Date.now()}@example.com`);
  const forbidden = await raw('GET', '/api/admin/installs', { token: userToken });
  assert(
    'non-admin cannot read install counts (403)',
    forbidden.status === 403,
    `status ${forbidden.status}`,
  );

  console.log(`\n${'─'.repeat(48)}`);
  console.log(`  ${passed} passed, ${failed} failed`);
  if (failed) {
    console.log('\nFailures:');
    for (const f of failures) console.log(`  • ${f}`);
  }
  console.log('');
  process.exitCode = failed ? 1 : 0;
}

main().catch((e) => {
  console.error('\nTelemetry e2e crashed:', e?.stack || e);
  process.exitCode = 1;
});
