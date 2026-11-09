import { randomBytes } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

/**
 * Secrets that must never be used to sign real sessions — the shipped defaults
 * and obvious dev values. If BETTER_AUTH_SECRET matches one of these we treat it
 * as "unset" and fall back to a generated, persisted secret.
 */
const KNOWN_PLACEHOLDERS = new Set([
  '',
  'change-me-to-a-long-random-secret',
  'dev-secret-change-me',
  'dev-secret',
  'secret',
]);

const MIN_SECRET_LEN = 16;
/** File (inside the persistent data volume) where a generated secret is stored. */
export const SECRET_FILENAME = '.auth-secret';

/** Directory that holds the SQLite DB — i.e. the persistent `/data` volume. */
function dataDirFromDbUrl(dbUrl: string): string | null {
  if (!dbUrl.startsWith('file:')) return null; // remote libSQL/Turso — nothing local to persist to
  const path = dbUrl.slice('file:'.length);
  if (!path || path.startsWith(':')) return null; // e.g. :memory:
  return dirname(path) || '.';
}

export interface ResolvedSecret {
  secret: string;
  /** Where the secret came from — useful for a one-line boot log. */
  source: 'env' | 'persisted' | 'generated' | 'ephemeral';
}

/**
 * Resolve the better-auth session-signing secret for the self-hosted Community
 * Edition so that `docker compose up` is both zero-config AND secure:
 *
 *  1. An explicit, non-placeholder `BETTER_AUTH_SECRET` always wins.
 *  2. Otherwise a strong 256-bit secret is generated once and persisted next to
 *     the database in the data volume, then reused on every restart — so users
 *     stay logged in across restarts without anyone having to pick a secret.
 *  3. If the data volume is not writable, a secret is still generated for this
 *     process (secure, but sessions won't survive a restart).
 *
 * The secret only signs sessions, so rotating it simply logs everyone out; no
 * data is ever at risk.
 */
export function resolveSelfHostSecret(
  env: { BETTER_AUTH_SECRET?: string | undefined },
  dbUrl: string,
): ResolvedSecret {
  const provided = env.BETTER_AUTH_SECRET?.trim();
  if (provided && provided.length >= MIN_SECRET_LEN && !KNOWN_PLACEHOLDERS.has(provided)) {
    return { secret: provided, source: 'env' };
  }

  const dir = dataDirFromDbUrl(dbUrl);
  if (dir) {
    const file = join(dir, SECRET_FILENAME);
    try {
      if (existsSync(file)) {
        const existing = readFileSync(file, 'utf8').trim();
        if (existing.length >= MIN_SECRET_LEN) return { secret: existing, source: 'persisted' };
      }
    } catch {
      // Unreadable — fall through and try to (re)generate.
    }

    const secret = randomBytes(32).toString('hex');
    try {
      mkdirSync(dir, { recursive: true });
      writeFileSync(file, secret, { encoding: 'utf8', mode: 0o600 });
      try {
        chmodSync(file, 0o600);
      } catch {
        // chmod is best-effort (e.g. on Windows bind mounts).
      }
      return { secret, source: 'generated' };
    } catch {
      // Could not persist (read-only fs) — use it just for this process.
      return { secret, source: 'ephemeral' };
    }
  }

  // No local data dir (remote DB) and no usable secret: generate an ephemeral one.
  return { secret: randomBytes(32).toString('hex'), source: 'ephemeral' };
}
