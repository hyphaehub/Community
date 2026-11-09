#!/usr/bin/env node
/**
 * Sync the standalone Expo app (the one that builds on EAS) from the canonical
 * monorepo app at apps/mobile.
 *
 * WHY: apps/mobile is where mobile dev happens — it imports the live
 * `@hyphaehub/core` types. The standalone `hyphaehub-mobile` repo exists only
 * because the monorepo variant can't package APKs (Gradle + workspace deps), so
 * it vendors a core subset and uses a flat npm install. Without a generator the
 * two drift. This copies the app SOURCE from apps/mobile into the standalone,
 * rewriting the core import to the vendored path, and leaves the standalone's
 * build shell (package.json, metro/babel/tsconfig, eas.json, app.json) and its
 * hand-vendored src/lib/core.ts untouched.
 *
 * Usage:  node scripts/sync-standalone-mobile.mjs [destDir]
 *         destDir defaults to ../hypheahub-mobile (or $HYPHAEHUB_MOBILE_DIR)
 *         NOTE: the standalone dir keeps the old spelling "hypheahub-mobile"
 *         (never renamed); the repo/package inside it is "hyphaehub".
 */
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'apps', 'mobile');
const DEST =
  process.argv[2] ||
  process.env.HYPHAEHUB_MOBILE_DIR ||
  resolve(ROOT, '..', 'hypheahub-mobile');

// Refuse to run against a non-existent target — the standalone repo must already
// be checked out. This avoids silently creating a stray directory on a typo.
if (!existsSync(join(DEST, 'app.json')) || !existsSync(join(DEST, 'src', 'lib', 'core.ts'))) {
  console.error(
    `Standalone mobile repo not found at: ${DEST}\n` +
      `Clone/checkout hyphaehub-mobile there, or pass its path:\n` +
      `  node scripts/sync-standalone-mobile.mjs <path-to-hyphaehub-mobile>`,
  );
  process.exit(1);
}

// Source files synced verbatim (code) — everything under app/, plus these
// src/lib modules. src/lib/core.ts is the vendored subset and is NOT synced.
const LIB_FILES = ['api.ts', 'auth.tsx', 'format.ts', 'journal.tsx', 'notifications.ts', 'theme.ts'];
const CORE_FROM = /@hyphaehub\/core/g;
const CORE_TO = '@/lib/core';

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}

/** Rewrite the core import for code files; copy others byte-for-byte. */
function syncFile(absSrc, relPath) {
  const dest = join(DEST, relPath);
  mkdirSync(dirname(dest), { recursive: true });
  if (/\.(ts|tsx|js|jsx)$/.test(absSrc)) {
    const rewritten = readFileSync(absSrc, 'utf8').replace(CORE_FROM, CORE_TO);
    writeFileSync(dest, rewritten);
  } else {
    cpSync(absSrc, dest);
  }
  return relPath.replace(/\\/g, '/');
}

const written = [];
// 1) app/** (screens + router)
for (const abs of walk(join(SRC, 'app'))) written.push(syncFile(abs, relative(SRC, abs)));
// 2) selected src/lib modules
for (const f of LIB_FILES) {
  const abs = join(SRC, 'src', 'lib', f);
  if (existsSync(abs)) written.push(syncFile(abs, join('src', 'lib', f)));
}
// 3) assets/** (icon, splash, favicon)
const assetsDir = join(SRC, 'assets');
if (existsSync(assetsDir)) for (const abs of walk(assetsDir)) written.push(syncFile(abs, relative(SRC, abs)));

// ── Drift guard: every identifier the synced code imports from the vendored
//    core must actually be exported by the standalone's src/lib/core.ts. ──────
function importedCoreNames() {
  const names = new Set();
  const re = /import\s+(?:type\s+)?\{([^}]*)\}\s*from\s*['"]@\/lib\/core['"]/g;
  for (const rel of written) {
    if (!/\.(ts|tsx)$/.test(rel)) continue;
    const text = readFileSync(join(DEST, rel), 'utf8');
    let m;
    // biome-ignore lint/suspicious/noAssignInExpressions: standard regex-exec loop
    while ((m = re.exec(text))) {
      for (const raw of m[1].split(',')) {
        const id = raw.trim().replace(/^type\s+/, '').split(/\s+as\s+/)[0].trim();
        if (id) names.add(id);
      }
    }
  }
  return names;
}
function exportedCoreNames() {
  const names = new Set();
  const corePath = join(DEST, 'src', 'lib', 'core.ts');
  if (!existsSync(corePath)) return names;
  const text = readFileSync(corePath, 'utf8');
  for (const m of text.matchAll(/export\s+(?:const|function|class|type|interface|enum)\s+([A-Za-z0-9_]+)/g))
    names.add(m[1]);
  for (const m of text.matchAll(/export\s*\{([^}]*)\}/g))
    for (const raw of m[1].split(',')) {
      const id = raw.trim().split(/\s+as\s+/).pop()?.trim();
      if (id) names.add(id);
    }
  return names;
}

const imported = importedCoreNames();
const exported = exportedCoreNames();
const missing = [...imported].filter((n) => !exported.has(n));

console.log(`Synced ${written.length} files from apps/mobile → ${DEST}`);
if (missing.length) {
  console.error(
    `\n⚠ Vendored core drift: apps/mobile imports these from @hyphaehub/core but the\n` +
      `  standalone src/lib/core.ts does not export them. Add them to core.ts:\n` +
      missing.map((n) => `    - ${n}`).join('\n'),
  );
  process.exit(1);
}
console.log('✓ Vendored core covers every imported symbol. Standalone is in sync.');
