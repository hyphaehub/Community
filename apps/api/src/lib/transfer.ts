import {
  events,
  type HyphaeDB,
  type Workspace,
  batches,
  costEntries,
  cultures,
  harvests,
  inventoryAdjustments,
  inventoryItems,
  lineage,
  memberships,
  newId,
  photos,
  strainCategories,
  strains,
  workspaces,
} from '@hyphaehub/db';
import { eq } from 'drizzle-orm';
import type { Storage } from '../storage';
import { chunk, insertChunkSize } from './batch';

/**
 * Portable, platform-agnostic workspace transfer (the "move my data between
 * cloud and self-hosting" feature). Because the export/import run over the same
 * `db` + `storage` abstractions the rest of the API uses, the exact same code
 * works on the cloud (D1 + R2) and on a self-hosted instance (libSQL + local
 * FS) — so cloud→local and local→cloud are the same operation in each direction.
 */

export const ARCHIVE_KIND = 'hyphaehub.workspace-export';
export const ARCHIVE_VERSION = 1;

/**
 * Tables that make up a workspace's data, in dependency order (parents first).
 * `fks` are id columns that must be remapped to the new ids on import; every
 * field in `required` must resolve or the row is skipped (its parent is gone);
 * `dates` are timestamp columns to revive from their ISO strings.
 */
const TABLES = [
  { key: 'strains', table: strains, fks: [], required: [], dates: ['createdAt', 'updatedAt'] },
  { key: 'strainCategories', table: strainCategories, fks: [], required: [], dates: ['createdAt'] },
  {
    key: 'inventoryItems',
    table: inventoryItems,
    fks: [],
    required: [],
    dates: ['createdAt', 'updatedAt'],
  },
  {
    key: 'batches',
    table: batches,
    fks: ['strainId'],
    required: [],
    dates: ['startedAt', 'completedAt', 'createdAt', 'updatedAt'],
  },
  {
    key: 'cultures',
    table: cultures,
    fks: ['batchId', 'strainId'],
    required: [],
    dates: ['inoculatedAt', 'colonizedAt', 'fruitingStartedAt', 'createdAt', 'updatedAt'],
  },
  {
    key: 'lineage',
    table: lineage,
    fks: ['parentCultureId', 'childCultureId'],
    required: ['parentCultureId', 'childCultureId'],
    dates: ['createdAt'],
  },
  {
    key: 'events',
    table: events,
    fks: ['cultureId', 'batchId'],
    required: ['cultureId'],
    dates: ['occurredAt', 'createdAt'],
  },
  {
    key: 'harvests',
    table: harvests,
    fks: ['cultureId', 'batchId'],
    required: ['cultureId'],
    dates: ['harvestedAt', 'driedAt', 'createdAt', 'updatedAt'],
  },
  {
    key: 'inventoryAdjustments',
    table: inventoryAdjustments,
    fks: ['inventoryItemId'],
    required: ['inventoryItemId'],
    dates: ['createdAt'],
  },
  {
    key: 'costEntries',
    table: costEntries,
    fks: ['batchId', 'cultureId', 'inventoryItemId'],
    required: [],
    dates: ['occurredAt', 'createdAt'],
  },
] as const;

type Row = Record<string, unknown>;

/** ID-independent fingerprint of a workspace's data, for 1:1 transfer checks. */
export interface Fingerprint {
  counts: Record<string, number>;
  totals: {
    costCents: number;
    wetG: number;
    dryG: number;
    drySubstrateG: number;
    photoBytes: number;
    lineageEdges: number;
  };
  /** Per-table content hash, so a mismatch pinpoints the table. */
  tableHashes: Record<string, string>;
  hash: string;
}

export interface WorkspaceArchive {
  hyphaehub: {
    kind: typeof ARCHIVE_KIND;
    version: number;
    exportedAt: string;
    sourceWorkspaceId: string;
  };
  workspace: { name: string; plan: string; features: unknown };
  /** Fingerprint of the exported data, so an import can verify it 1:1. */
  fingerprint?: Fingerprint;
  data: Record<string, Row[]>;
}

// ── base64 (cross-runtime: Workers + Node both have btoa/atob) ───────────────
function bytesToBase64(bytes: Uint8Array): string {
  let bin = '';
  const step = 0x8000;
  for (let i = 0; i < bytes.length; i += step) {
    bin += String.fromCharCode(...bytes.subarray(i, i + step));
  }
  return btoa(bin);
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function streamToBytes(body: ReadableStream): Promise<Uint8Array> {
  return new Uint8Array(await new Response(body).arrayBuffer());
}

// ── 1:1 transfer fingerprint ─────────────────────────────────────────────────
async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');
}

function num(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

/** Stable, id-independent serialization of a row's own content (drops ids/FKs/blob). */
function canonicalRow(row: Row): string {
  // Drop ids, the workspace id, every FK id, the photo blob, and the photo
  // storage `key` — all instance-specific; only content must match 1:1.
  const keys = Object.keys(row)
    .filter(
      (k) => k !== 'id' && k !== 'workspaceId' && k !== 'data' && k !== 'key' && !k.endsWith('Id'),
    )
    .sort();
  return keys.map((k) => `${k}=${JSON.stringify(row[k] ?? null)}`).join('|');
}

/** Read a workspace's rows (table rows + photo metadata, no blobs). */
async function readWorkspaceData(db: HyphaeDB, wsId: string): Promise<Record<string, Row[]>> {
  const data: Record<string, Row[]> = {};
  for (const t of TABLES) {
    data[t.key] = (await db
      .select()
      .from(t.table)
      .where(eq((t.table as never as { workspaceId: never }).workspaceId, wsId))) as Row[];
  }
  data.photos = (await db.select().from(photos).where(eq(photos.workspaceId, wsId))) as Row[];
  return data;
}

/**
 * Fingerprint a workspace's data: per-table counts, key totals, and a content
 * hash with foreign keys resolved to names — so the source and the imported copy
 * produce the IDENTICAL fingerprint despite every id being remapped.
 */
export async function computeFingerprint(data: Record<string, Row[]>): Promise<Fingerprint> {
  const rows = (k: string) => data[k] ?? [];
  const nameMap = (arr: Row[], nameKey: string) => {
    const m = new Map<string, string>();
    for (const r of arr) if (r.id != null) m.set(String(r.id), String(r[nameKey] ?? ''));
    return m;
  };
  const culture = nameMap(rows('cultures'), 'label');
  const batch = nameMap(rows('batches'), 'name');
  const strain = nameMap(rows('strains'), 'commonName');
  const item = nameMap(rows('inventoryItems'), 'name');
  const ref = (m: Map<string, string>, id: unknown) =>
    id == null ? '' : (m.get(String(id)) ?? '?');

  const canon: Record<string, string[]> = {};
  const add = (key: string, extra: (r: Row) => Record<string, unknown> = () => ({})) => {
    canon[key] = rows(key)
      .map((r) => canonicalRow({ ...r, ...extra(r) }))
      .sort();
  };
  add('strains');
  add('strainCategories');
  add('inventoryItems');
  add('inventoryAdjustments', (r) => ({ _item: ref(item, r.inventoryItemId) }));
  add('batches', (r) => ({ _strain: ref(strain, r.strainId) }));
  add('cultures', (r) => ({ _batch: ref(batch, r.batchId), _strain: ref(strain, r.strainId) }));
  add('lineage', (r) => ({
    _edge: `${ref(culture, r.parentCultureId)}>${ref(culture, r.childCultureId)}`,
  }));
  add('events', (r) => ({ _culture: ref(culture, r.cultureId), _batch: ref(batch, r.batchId) }));
  add('harvests', (r) => ({ _culture: ref(culture, r.cultureId), _batch: ref(batch, r.batchId) }));
  add('costEntries', (r) => ({
    _batch: ref(batch, r.batchId),
    _culture: ref(culture, r.cultureId),
    _item: ref(item, r.inventoryItemId),
  }));
  add('photos', (r) => ({ _culture: ref(culture, r.cultureId) }));

  const counts: Record<string, number> = {};
  for (const k of Object.keys(canon)) counts[k] = rows(k).length;

  const totals = {
    costCents: rows('costEntries').reduce((s, r) => s + num(r.amountCents), 0),
    wetG: rows('harvests').reduce((s, r) => s + num(r.wetWeightG), 0),
    dryG: rows('harvests').reduce((s, r) => s + num(r.dryWeightG), 0),
    drySubstrateG: rows('cultures').reduce((s, r) => s + num(r.drySubstrateG), 0),
    photoBytes: rows('photos').reduce((s, r) => s + num(r.sizeBytes), 0),
    lineageEdges: rows('lineage').length,
  };

  const tableHashes: Record<string, string> = {};
  for (const k of Object.keys(canon).sort()) {
    tableHashes[k] = await sha256Hex((canon[k] ?? []).join('\n'));
  }
  const hash = await sha256Hex(
    Object.keys(tableHashes)
      .sort()
      .map((k) => `${k}:${tableHashes[k]}`)
      .join('|'),
  );
  return { counts, totals, tableHashes, hash };
}

/** Human-readable differences between two fingerprints (empty = identical). */
export function diffFingerprints(a: Fingerprint, b: Fingerprint): string[] {
  const out: string[] = [];
  for (const k of new Set([...Object.keys(a.counts), ...Object.keys(b.counts)])) {
    if ((a.counts[k] ?? 0) !== (b.counts[k] ?? 0)) {
      out.push(`${k} count: ${a.counts[k] ?? 0} vs ${b.counts[k] ?? 0}`);
    }
  }
  for (const k of Object.keys(a.totals) as (keyof Fingerprint['totals'])[]) {
    if (a.totals[k] !== b.totals[k]) out.push(`${k}: ${a.totals[k]} vs ${b.totals[k]}`);
  }
  for (const k of new Set([...Object.keys(a.tableHashes), ...Object.keys(b.tableHashes)])) {
    if (a.tableHashes[k] !== b.tableHashes[k]) out.push(`${k} content differs`);
  }
  return out;
}

/** Compute the current fingerprint of a live workspace. */
export async function fingerprintWorkspace(db: HyphaeDB, wsId: string): Promise<Fingerprint> {
  return computeFingerprint(await readWorkspaceData(db, wsId));
}

/**
 * Serialize a workspace (its rows across every workspace-scoped table, plus the
 * photo blobs as base64) into a single portable JSON archive. Preset strains,
 * memberships, users, audit logs and billing fields are intentionally left out —
 * they are instance-specific and the importer re-establishes them.
 */
export async function exportWorkspace(
  db: HyphaeDB,
  storage: Storage,
  ws: Workspace,
  opts: { includePhotos?: boolean } = {},
): Promise<WorkspaceArchive> {
  const data: Record<string, Row[]> = {};
  for (const t of TABLES) {
    const rows = await db
      .select()
      .from(t.table)
      .where(eq((t.table as never as { workspaceId: never }).workspaceId, ws.id));
    data[t.key] = rows as Row[];
  }

  const photoRows = (await db.select().from(photos).where(eq(photos.workspaceId, ws.id))) as Row[];
  const includePhotos = opts.includePhotos !== false;
  const exportedPhotos: Row[] = [];
  for (const p of photoRows) {
    let blob: string | null = null;
    if (includePhotos) {
      try {
        const obj = await storage.get(p.key as string);
        if (obj) blob = bytesToBase64(await streamToBytes(obj.body));
      } catch {
        blob = null; // a missing blob should not abort the whole export
      }
    }
    exportedPhotos.push({ ...p, data: blob });
  }
  data.photos = exportedPhotos;

  return {
    hyphaehub: {
      kind: ARCHIVE_KIND,
      version: ARCHIVE_VERSION,
      exportedAt: new Date().toISOString(),
      sourceWorkspaceId: ws.id,
    },
    workspace: { name: ws.name, plan: ws.plan, features: ws.features ?? null },
    fingerprint: await computeFingerprint(data),
    data,
  };
}

export interface ImportResult {
  workspaceId: string;
  counts: Record<string, number>;
  /** True when the archive carried a fingerprint and the import matched it 1:1. */
  verified: boolean;
  /** Human-readable differences when not verified (empty when verified). */
  mismatches: string[];
  /** Fingerprint of the imported workspace. */
  fingerprint: Fingerprint;
  /** Fingerprint recorded in the archive (null for an older archive). */
  sourceFingerprint: Fingerprint | null;
}

/** Shape-check an untrusted archive before we touch the database. */
export function isWorkspaceArchive(x: unknown): x is WorkspaceArchive {
  const a = x as WorkspaceArchive | null;
  return (
    !!a &&
    a.hyphaehub?.kind === ARCHIVE_KIND &&
    typeof a.hyphaehub?.version === 'number' &&
    !!a.workspace &&
    typeof a.workspace.name === 'string' &&
    !!a.data &&
    typeof a.data === 'object'
  );
}

/**
 * Ingest an archive into a BRAND-NEW workspace owned by `userId` (never clobbers
 * existing data), remapping every id, reviving dates, restoring photo blobs, and
 * re-pointing foreign keys. Plan limits are intentionally not enforced — a
 * migration must not be blocked by them. On any failure the half-written
 * workspace (and the blobs written for it) are removed so nothing is orphaned.
 */
export async function importWorkspace(
  db: HyphaeDB,
  storage: Storage,
  userId: string,
  archive: WorkspaceArchive,
): Promise<ImportResult> {
  if (archive.hyphaehub.version > ARCHIVE_VERSION) {
    throw new Error(`Unsupported archive version ${archive.hyphaehub.version}`);
  }

  const newWsId = newId();
  const writtenKeys: string[] = [];
  const counts: Record<string, number> = {};
  const idMap = new Map<string, string>();

  try {
    await db.insert(workspaces).values({
      id: newWsId,
      name: `${archive.workspace.name} (imported)`,
      ownerUserId: userId,
      plan: archive.workspace.plan as never,
      features: (archive.workspace.features ?? null) as never,
    });
    await db.insert(memberships).values({ workspaceId: newWsId, userId, role: 'OWNER' });

    for (const t of TABLES) {
      const src = (archive.data[t.key] ?? []) as Row[];
      const out: Row[] = [];
      for (const row of src) {
        const id = newId();
        idMap.set(row.id as string, id);
        const next: Row = { ...row, id, workspaceId: newWsId };

        let skip = false;
        for (const fk of t.fks) {
          const oldVal = row[fk] as string | null | undefined;
          if (oldVal == null) {
            next[fk] = null;
            continue;
          }
          const mapped = idMap.get(oldVal) ?? null;
          if (mapped == null && (t.required as readonly string[]).includes(fk)) {
            skip = true;
            break;
          }
          next[fk] = mapped;
        }
        if (skip) continue;

        for (const d of t.dates) {
          if (typeof next[d] === 'string') next[d] = new Date(next[d] as string);
        }
        out.push(next);
      }
      if (out.length) {
        const perRow = Object.keys(out[0] as Row).length;
        for (const group of chunk(out, insertChunkSize(perRow))) {
          await db.insert(t.table as never).values(group as never);
        }
      }
      counts[t.key] = out.length;
    }

    // Photos: re-point fks, write the decoded blob under a fresh key, insert row.
    const srcPhotos = (archive.data.photos ?? []) as Row[];
    const photoRows: Row[] = [];
    for (const p of srcPhotos) {
      const id = newId();
      const key = `${newWsId}/${id}`;
      const blob = p.data as string | null | undefined;
      if (blob) {
        await storage.put(key, base64ToBytes(blob), (p.contentType as string) || undefined);
        writtenKeys.push(key);
      }
      photoRows.push({
        id,
        workspaceId: newWsId,
        cultureId: p.cultureId ? (idMap.get(p.cultureId as string) ?? null) : null,
        eventId: p.eventId ? (idMap.get(p.eventId as string) ?? null) : null,
        harvestId: p.harvestId ? (idMap.get(p.harvestId as string) ?? null) : null,
        key,
        caption: p.caption ?? null,
        contentType: p.contentType ?? null,
        sizeBytes: p.sizeBytes ?? null,
        createdAt: typeof p.createdAt === 'string' ? new Date(p.createdAt) : new Date(),
      });
    }
    if (photoRows.length) {
      for (const group of chunk(
        photoRows,
        insertChunkSize(Object.keys(photoRows[0] as Row).length),
      )) {
        await db.insert(photos).values(group as never);
      }
    }
    counts.photos = photoRows.length;

    // Verify the import reproduced the source 1:1 (ids differ, content must not).
    const sourceFingerprint = archive.fingerprint ?? null;
    const fingerprint = await computeFingerprint(await readWorkspaceData(db, newWsId));
    const mismatches = sourceFingerprint ? diffFingerprints(sourceFingerprint, fingerprint) : [];
    const verified = !!sourceFingerprint && mismatches.length === 0;
    return { workspaceId: newWsId, counts, verified, mismatches, fingerprint, sourceFingerprint };
  } catch (err) {
    // Roll back: deleting the workspace cascades to every imported row; remove
    // any blobs we wrote (storage is not covered by the DB cascade).
    await Promise.allSettled(writtenKeys.map((k) => storage.delete(k)));
    await db
      .delete(workspaces)
      .where(eq(workspaces.id, newWsId))
      .catch(() => {});
    throw err;
  }
}
