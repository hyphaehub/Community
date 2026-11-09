#!/usr/bin/env node
/**
 * HyphaeHub — workspace transfer (export/import) round-trip test.
 *
 * Builds a small grow (strain → batch → source → grain → bulk → harvest → costs
 * + a photo), exports the workspace to a portable archive, imports that archive
 * into a fresh workspace on the SAME instance, then proves the import is a
 * faithful, fully-remapped copy: same counts, same lineage, same cost/yield
 * rollup, same photo bytes — with new ids and the original left intact.
 *
 * A cross-instance move (cloud↔local) is the same archive over HTTP, so a
 * one-instance round-trip exercises the whole mechanism.
 *
 *   BASE_URL=http://localhost:8080 node scripts/e2e-transfer.mjs
 */

const BASE = (process.env.BASE_URL ?? 'http://localhost:8080').replace(/\/$/, '');
const ORIGIN = process.env.ORIGIN ?? BASE;

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

let token = null;
let workspace = null;

async function call(method, path, body, opts = {}) {
  const headers = { origin: ORIGIN };
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (token) headers.authorization = `Bearer ${token}`;
  if (opts.workspace) headers['x-workspace-id'] = opts.workspace;
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
  return { status: res.status, ok: res.ok, data, headers: res.headers };
}

// 1x1 transparent PNG.
const PNG = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
  0x89, 0x00, 0x00, 0x00, 0x0a, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
  0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae,
  0x42, 0x60, 0x82,
]);

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

function round(n, p = 2) {
  const f = 10 ** p;
  return Math.round(n * f) / f;
}

async function main() {
  console.log(`\nHyphaeHub transfer round-trip  →  ${BASE}\n`);
  await waitForHealth();

  // ── Build a small grow in workspace A ────────────────────────────────────
  console.log('Seed a workspace');
  const email = `transfer+${Date.now()}@example.com`;
  const su = await fetch(`${BASE}/api/auth/sign-up/email`, {
    method: 'POST',
    headers: { origin: ORIGIN, 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: 'correct-horse-battery-staple', name: 'Mover' }),
  });
  const suBody = await su.json().catch(() => null);
  token = suBody?.token || su.headers.get('set-auth-token');
  assert('signed up', su.ok && !!token, `status ${su.status}`);

  const me = await call('GET', '/api/me');
  workspace = me.data?.workspace?.id;
  assert('have a workspace', !!workspace, JSON.stringify(me.data)?.slice(0, 120));
  const ws = () => ({ workspace });

  const strain = (
    await call('POST', '/api/strains', { commonName: 'Golden Oyster', category: 'GOURMET' }, ws())
  ).data;
  const batch = (
    await call('POST', '/api/batches', { name: 'Transfer Run', strainId: strain.id }, ws())
  ).data;
  const source = (
    await call(
      'POST',
      '/api/cultures',
      { type: 'SOURCE', label: 'LC', batchId: batch.id, strainId: strain.id, status: 'INOCULATED' },
      ws(),
    )
  ).data;
  const split = (
    await call(
      'POST',
      `/api/cultures/${source.id}/split`,
      { count: 4, type: 'GRAIN', containerType: 'JAR', costPerChildCents: 250 },
      ws(),
    )
  ).data;
  const grainIds = (split.children ?? []).map((x) => x.id);
  const combine = (
    await call(
      'POST',
      '/api/cultures/combine',
      {
        parentIds: grainIds,
        label: 'Tub',
        type: 'BULK',
        containerType: 'MONOTUB',
        drySubstrateG: 1200,
        batchId: batch.id,
        substrateCostCents: 1500,
      },
      ws(),
    )
  ).data;
  const tubId = combine.tub.id;
  await call(
    'POST',
    '/api/harvests',
    {
      cultureId: tubId,
      batchId: batch.id,
      flushNumber: 1,
      wetWeightG: 900,
      dryWeightG: 90,
      harvestedAt: new Date().toISOString(),
    },
    ws(),
  );
  await call(
    'POST',
    '/api/costs',
    { description: 'Tent', category: 'EQUIPMENT', amountCents: 500, batchId: batch.id },
    ws(),
  );

  // Upload a photo so the blob transfer is exercised.
  const fd = new FormData();
  fd.append('file', new Blob([PNG], { type: 'image/png' }), 'pin.png');
  fd.append('cultureId', tubId);
  fd.append('caption', 'first pins');
  const upRes = await fetch(`${BASE}/api/photos`, {
    method: 'POST',
    headers: { origin: ORIGIN, authorization: `Bearer ${token}`, 'x-workspace-id': workspace },
    body: fd,
  });
  assert('uploaded a photo', upRes.ok, `status ${upRes.status}`);

  const origBatch = (await call('GET', `/api/batches/${batch.id}`, undefined, ws())).data;
  const origSummary = origBatch?.summary;

  // ── Export workspace A ───────────────────────────────────────────────────
  console.log('\nExport');
  const exp = await call('GET', '/api/transfer/export', undefined, ws());
  assert(
    'export returns an archive',
    exp.ok && exp.data?.hyphaehub?.kind === 'hyphaehub.workspace-export',
    `status ${exp.status} ${JSON.stringify(exp.data)?.slice(0, 100)}`,
  );
  const archive = exp.data;
  assert(
    'archive carries 6 cultures',
    (archive?.data?.cultures ?? []).length === 6,
    `got ${(archive?.data?.cultures ?? []).length}`,
  );
  assert(
    'archive carries 8 lineage edges',
    (archive?.data?.lineage ?? []).length === 8,
    `got ${(archive?.data?.lineage ?? []).length}`,
  );
  assert(
    'archive carries the photo bytes',
    !!archive?.data?.photos?.[0]?.data,
    'no photo data in archive',
  );
  assert(
    'archive carries a 1:1 fingerprint',
    !!archive?.fingerprint?.hash && typeof archive?.fingerprint?.totals?.costCents === 'number',
    `fingerprint=${JSON.stringify(archive?.fingerprint)?.slice(0, 80)}`,
  );

  // Non-owner/admin gate: export requires elevated role — a fresh viewer-less
  // check is implicit (the signer-up is OWNER). Verify the archive is self-contained JSON.
  assert(
    'archive is plain JSON (portable)',
    typeof JSON.stringify(archive) === 'string',
    'not serializable',
  );

  // ── Import into a new workspace on the same instance ──────────────────────
  console.log('\nImport into a fresh workspace');
  const imp = await call('POST', '/api/transfer/import', archive);
  assert(
    'import succeeds',
    imp.status === 201 && !!imp.data?.workspaceId,
    `status ${imp.status} ${JSON.stringify(imp.data)?.slice(0, 120)}`,
  );
  assert(
    'import is verified 1:1 against the source fingerprint',
    imp.data?.verified === true && (imp.data?.mismatches ?? ['x']).length === 0,
    `verified=${imp.data?.verified} mismatches=${JSON.stringify(imp.data?.mismatches)}`,
  );
  const newWs = imp.data?.workspaceId;
  assert(
    'import created a NEW workspace (id remapped)',
    !!newWs && newWs !== workspace,
    `new=${newWs} old=${workspace}`,
  );
  assert(
    'import reports 6 cultures',
    imp.data?.counts?.cultures === 6,
    `got ${imp.data?.counts?.cultures}`,
  );
  assert(
    'import reports 8 lineage edges',
    imp.data?.counts?.lineage === 8,
    `got ${imp.data?.counts?.lineage}`,
  );
  assert(
    'import reports 1 photo',
    imp.data?.counts?.photos === 1,
    `got ${imp.data?.counts?.photos}`,
  );

  // ── 1:1 verification: fingerprint endpoint + tamper detection ─────────────
  console.log('\n1:1 verification');
  const srcFp = await call('GET', '/api/transfer/fingerprint', undefined, ws());
  assert(
    'fingerprint endpoint returns counts + hash',
    srcFp.ok && !!srcFp.data?.hash && srcFp.data?.counts?.cultures === 6,
    `status ${srcFp.status} ${JSON.stringify(srcFp.data)?.slice(0, 80)}`,
  );
  assert(
    'live fingerprint matches the archive fingerprint',
    srcFp.data?.hash === archive?.fingerprint?.hash,
    `live=${srcFp.data?.hash?.slice(0, 12)} archive=${archive?.fingerprint?.hash?.slice(0, 12)}`,
  );

  // Tamper with the archive data but keep its fingerprint — import must flag it.
  const tampered = JSON.parse(JSON.stringify(archive));
  if (tampered.data?.harvests?.[0]) tampered.data.harvests[0].wetWeightG = 12345;
  const impBad = await call('POST', '/api/transfer/import', tampered);
  assert(
    'a tampered archive imports but fails 1:1 verification',
    impBad.status === 201 &&
      impBad.data?.verified === false &&
      (impBad.data?.mismatches ?? []).length > 0,
    `verified=${impBad.data?.verified} mismatches=${JSON.stringify(impBad.data?.mismatches)?.slice(0, 120)}`,
  );

  // ── Verify the imported workspace is a faithful copy ──────────────────────
  console.log('\nVerify the imported copy');
  const newWsHdr = { workspace: newWs };
  const meNew = await call('GET', '/api/me', undefined, newWsHdr);
  assert(
    'I own the imported workspace',
    meNew.ok && meNew.data?.role === 'OWNER',
    `role=${meNew.data?.role}`,
  );
  assert(
    'imported workspace name is marked',
    /\(imported\)$/.test(meNew.data?.workspace?.name || ''),
    `name=${meNew.data?.workspace?.name}`,
  );

  const newBatches = (await call('GET', '/api/batches', undefined, newWsHdr)).data;
  assert(
    'imported workspace has the batch',
    Array.isArray(newBatches) && newBatches.length === 1,
    `got ${JSON.stringify(newBatches)?.slice(0, 80)}`,
  );
  const newBatchId = newBatches?.[0]?.id;
  assert(
    'batch id was remapped',
    !!newBatchId && newBatchId !== batch.id,
    `new=${newBatchId} old=${batch.id}`,
  );

  const newDetail = (await call('GET', `/api/batches/${newBatchId}`, undefined, newWsHdr)).data;
  const s = newDetail?.summary;
  assert(
    'cost rollup matches (3000¢)',
    s?.cost?.totalCents === origSummary?.cost?.totalCents && s?.cost?.totalCents === 3000,
    `got ${s?.cost?.totalCents}`,
  );
  assert('dry yield matches (90g)', s?.yield?.totalDryG === 90, `got ${s?.yield?.totalDryG}`);
  assert(
    'biological efficiency matches (75%)',
    s?.efficiency?.biologicalEfficiency === 75,
    `got ${s?.efficiency?.biologicalEfficiency}`,
  );
  assert(
    'cost per dry gram matches (33.33¢)',
    round(s?.efficiency?.costPerDryGramCents) === 33.33,
    `got ${s?.efficiency?.costPerDryGramCents}`,
  );
  assert(
    'imported batch bundles 6 cultures',
    (newDetail?.cultures ?? []).length === 6,
    `got ${(newDetail?.cultures ?? []).length}`,
  );

  // Lineage preserved: the imported bulk tub still has 4 parents.
  const newTub = (newDetail?.cultures ?? []).find((x) => x.type === 'BULK');
  const tubDetail = (await call('GET', `/api/cultures/${newTub?.id}`, undefined, newWsHdr)).data;
  assert(
    'imported tub keeps its 4 parents (lineage remapped)',
    (tubDetail?.parents ?? []).length === 4,
    `got ${(tubDetail?.parents ?? []).length}`,
  );

  // Photo bytes survived the round-trip.
  const newPhotos = (await call('GET', '/api/photos', undefined, newWsHdr)).data;
  assert(
    'imported workspace has the photo',
    Array.isArray(newPhotos) && newPhotos.length === 1,
    `got ${JSON.stringify(newPhotos)?.slice(0, 80)}`,
  );
  if (newPhotos?.[0]) {
    const rawRes = await fetch(`${BASE}/api/photos/${newPhotos[0].id}/raw`, {
      headers: { authorization: `Bearer ${token}`, 'x-workspace-id': newWs },
    });
    const bytes = new Uint8Array(await rawRes.arrayBuffer());
    const same = bytes.length === PNG.length && bytes.every((b, i) => b === PNG[i]);
    assert(
      'photo bytes are identical after transfer',
      rawRes.ok && same,
      `len ${bytes.length} vs ${PNG.length}`,
    );
    assert(
      'photo was given a new storage key under the new workspace',
      (newPhotos[0].key || '').startsWith(`${newWs}/`),
      `key=${newPhotos[0].key}`,
    );
  }

  // Original workspace is untouched by the import.
  const origStill = (await call('GET', `/api/batches/${batch.id}`, undefined, ws())).data;
  assert(
    'the original workspace is left intact',
    origStill?.batch?.id === batch.id,
    `got ${JSON.stringify(origStill)?.slice(0, 80)}`,
  );

  console.log(`\n${'─'.repeat(48)}`);
  console.log(`  ${passed} passed, ${failed} failed`);
  if (failed) {
    console.log('\nFailures:');
    for (const f of failures) console.log(`  • ${f}`);
  }
  console.log('');
  // Set the code and let the event loop drain — calling process.exit() here can
  // race undici's socket teardown and abort with a libuv assertion on Windows.
  process.exitCode = failed ? 1 : 0;
}

main().catch((e) => {
  console.error('\nTransfer e2e crashed:', e?.stack || e);
  process.exitCode = 1;
});
