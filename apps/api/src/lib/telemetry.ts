import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

/**
 * Anonymous self-host telemetry (opt-out). On boot and once a day the Community
 * server sends a tiny, anonymous ping — a random install id, the version, and
 * the edition — to a central endpoint so the project can count real, running
 * installs (not fuzzy download numbers). No account link, no personal data, no
 * IP stored by the receiver. Disable entirely with HYPHAEHUB_TELEMETRY=off.
 */

/** Values that turn telemetry off. */
const OFF = new Set(['0', 'false', 'off', 'no']);
/** Default central endpoint (the official cloud). */
export const DEFAULT_TELEMETRY_URL = 'https://app.hyphaehub.io/api/telemetry';
/** File (in the persistent data volume) holding the anonymous install id. */
export const INSTALL_ID_FILENAME = '.install-id';

/** Telemetry is on unless explicitly disabled via HYPHAEHUB_TELEMETRY. */
export function telemetryEnabled(env: { HYPHAEHUB_TELEMETRY?: string | undefined }): boolean {
  const v = env.HYPHAEHUB_TELEMETRY?.trim().toLowerCase();
  return !(v && OFF.has(v));
}

/** Directory of the SQLite DB — i.e. the persistent `/data` volume. */
function dataDirFromDbUrl(dbUrl: string): string | null {
  if (!dbUrl.startsWith('file:')) return null;
  const p = dbUrl.slice('file:'.length);
  if (!p || p.startsWith(':')) return null;
  return dirname(p) || '.';
}

/**
 * A stable, anonymous per-install id (128-bit hex), generated once and persisted
 * in the data volume so it survives restarts. Falls back to an ephemeral id when
 * there is no writable data dir.
 */
export function resolveInstallId(dbUrl: string): string {
  const dir = dataDirFromDbUrl(dbUrl);
  if (dir) {
    const file = join(dir, INSTALL_ID_FILENAME);
    try {
      if (existsSync(file)) {
        const existing = readFileSync(file, 'utf8').trim();
        if (existing) return existing;
      }
    } catch {
      // fall through to generate
    }
    const id = randomBytes(16).toString('hex');
    try {
      mkdirSync(dir, { recursive: true });
      writeFileSync(file, id, { encoding: 'utf8', mode: 0o600 });
    } catch {
      // not persisted, but still usable for this process
    }
    return id;
  }
  return randomBytes(16).toString('hex');
}

export interface TelemetryOptions {
  installId: string;
  version: string;
  url: string;
  /** Ping cadence; defaults to 24h. */
  intervalMs?: number;
}

/**
 * Send the anonymous ping now and every `intervalMs` thereafter. Fire-and-forget:
 * it never throws and never blocks the server (failures are swallowed, the timer
 * is unref'd). Returns a stop() that clears the interval.
 */
export function startTelemetry(opts: TelemetryOptions): () => void {
  const payload = JSON.stringify({
    installId: opts.installId,
    version: opts.version,
    edition: 'community',
  });
  const send = () => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 5000);
    fetch(opts.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: payload,
      signal: ctrl.signal,
    })
      .catch(() => {})
      .finally(() => clearTimeout(timer));
  };
  send();
  const interval = setInterval(send, opts.intervalMs ?? 24 * 60 * 60 * 1000);
  if (typeof interval.unref === 'function') interval.unref();
  return () => clearInterval(interval);
}
