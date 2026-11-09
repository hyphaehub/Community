#!/usr/bin/env node
/**
 * HyphaeHub — Cloud Connect admin registry e2e.
 *
 * Exercises the "app registers links" model and the platform-admin view:
 * a user registers a link to their self-host, the super admin lists it, verifies
 * reachability (a real server-side ping of the target's /health), sees an
 * unreachable one reported as such, is gated from non-admins, and can revoke.
 *
 * The instance must be started with SUPER_ADMIN_EMAIL set to ADMIN_EMAIL below.
 *
 *   BASE_URL=http://localhost:8080 node scripts/e2e-connect-admin.mjs
 */

const BASE = (process.env.BASE_URL ?? 'http://localhost:8080').replace(/\/$/, '');
const ORIGIN = process.env.ORIGIN ?? BASE;
const ADMIN_EMAIL = process.env.ADMIN_EMAIL ?? 'admin@hyphae.test';
const PASSWORD = 'correct-horse-battery-staple';
// Reachable from INSIDE the container (the server's own internal origin).
const REACHABLE_URL = process.env.REACHABLE_URL ?? 'http://localhost:8080';
const UNREACHABLE_URL = 'http://127.0.0.1:9';

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

async function raw(method, path, { token, body, workspace } = {}) {
  const headers = { origin: ORIGIN };
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (token) headers.authorization = `Bearer ${token}`;
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
  console.log(`\nCloud Connect admin registry  →  ${BASE}\n`);
  await waitForHealth();

  // ── Super admin + a regular user ─────────────────────────────────────────
  console.log('Accounts');
  const adminToken = await signUpOrIn(ADMIN_EMAIL);
  assert('super admin signs in', !!adminToken, 'no admin token');
  const adminMe = await raw('GET', '/api/me', { token: adminToken });
  assert(
    'super admin is recognized (isSuperAdmin)',
    adminMe.data?.isSuperAdmin === true,
    `isSuperAdmin=${adminMe.data?.isSuperAdmin} (is SUPER_ADMIN_EMAIL=${ADMIN_EMAIL} set?)`,
  );

  const userToken = await signUpOrIn(`connect-user+${Date.now()}@example.com`);
  assert('regular user signs up', !!userToken, 'no user token');

  // ── Register a link (as the app would, on the user's cloud session) ───────
  console.log('\nRegister a connection');
  const reg = await raw('POST', '/api/connect', {
    token: userToken,
    body: { serverUrl: `${REACHABLE_URL}/`, label: 'My NAS' },
  });
  assert(
    'user registers a connect link',
    reg.status === 201 && !!reg.data?.id,
    `status ${reg.status} ${JSON.stringify(reg.data)?.slice(0, 100)}`,
  );
  assert(
    'server URL is normalized (trailing slash stripped)',
    reg.data?.serverUrl === REACHABLE_URL,
    `got ${reg.data?.serverUrl}`,
  );
  const linkId = reg.data?.id;

  const mine = await raw('GET', '/api/connect', { token: userToken });
  assert(
    'link shows in the user’s own list',
    Array.isArray(mine.data) && mine.data.length === 1,
    `got ${JSON.stringify(mine.data)?.slice(0, 100)}`,
  );

  // Idempotent: re-registering the same URL updates, does not duplicate.
  const reg2 = await raw('POST', '/api/connect', {
    token: userToken,
    body: { serverUrl: REACHABLE_URL, label: 'My NAS (home)' },
  });
  assert(
    're-register updates in place (no duplicate)',
    reg2.status === 201 && reg2.data?.id === linkId,
    `id ${reg2.data?.id} vs ${linkId}`,
  );
  const mine2 = await raw('GET', '/api/connect', { token: userToken });
  assert(
    'still exactly one link after re-register',
    (mine2.data ?? []).length === 1,
    `got ${(mine2.data ?? []).length}`,
  );

  // ── Admin view ───────────────────────────────────────────────────────────
  console.log('\nPlatform admin view');
  const adminList = await raw('GET', '/api/admin/connect-links', { token: adminToken });
  assert(
    'admin lists all connect links',
    adminList.ok && Array.isArray(adminList.data?.links),
    `status ${adminList.status}`,
  );
  const adminLink = (adminList.data?.links ?? []).find((l) => l.id === linkId);
  assert(
    'admin sees the link with the owner’s email',
    !!adminLink?.userEmail,
    JSON.stringify(adminLink)?.slice(0, 120),
  );

  // Non-admin is blocked from the admin registry.
  const forbidden = await raw('GET', '/api/admin/connect-links', { token: userToken });
  assert(
    'non-admin cannot read the admin registry → 403',
    forbidden.status === 403,
    `got ${forbidden.status}`,
  );

  // ── Verify reachability (real server-side ping) ──────────────────────────
  console.log('\nVerify reachability');
  const vOk = await raw('POST', `/api/admin/connect-links/${linkId}/verify`, { token: adminToken });
  assert(
    'verify reports the reachable instance as ok',
    vOk.ok && vOk.data?.reachable === true && vOk.data?.status === 'ok',
    `${JSON.stringify(vOk.data)?.slice(0, 120)}`,
  );
  const afterVerify = await raw('GET', '/api/admin/connect-links', { token: adminToken });
  const verified = (afterVerify.data?.links ?? []).find((l) => l.id === linkId);
  assert(
    'verify result is recorded on the link',
    verified?.lastStatus === 'ok' && !!verified?.lastVerifiedAt,
    `status=${verified?.lastStatus}`,
  );

  // An unreachable server is reported unreachable (not an error).
  const regBad = await raw('POST', '/api/connect', {
    token: userToken,
    body: { serverUrl: UNREACHABLE_URL, label: 'offline box' },
  });
  const badId = regBad.data?.id;
  const vBad = await raw('POST', `/api/admin/connect-links/${badId}/verify`, { token: adminToken });
  assert(
    'verify reports an unreachable instance as unreachable',
    vBad.ok && vBad.data?.reachable === false && vBad.data?.status === 'unreachable',
    `${JSON.stringify(vBad.data)?.slice(0, 120)}`,
  );

  // ── Revoke ───────────────────────────────────────────────────────────────
  console.log('\nRevoke');
  const del = await raw('DELETE', `/api/admin/connect-links/${linkId}`, { token: adminToken });
  assert('admin revokes a link', del.ok, `status ${del.status}`);
  const afterDel = await raw('GET', '/api/admin/connect-links', { token: adminToken });
  assert(
    'revoked link is gone from the registry',
    !(afterDel.data?.links ?? []).some((l) => l.id === linkId),
    'still present',
  );

  // User can forget their own remaining link.
  const delMine = await raw('DELETE', `/api/connect/${badId}`, { token: userToken });
  assert('user forgets their own link', delMine.ok, `status ${delMine.status}`);

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
  console.error('\nConnect-admin e2e crashed:', e?.stack || e);
  process.exitCode = 1;
});
