import { zValidator } from '@hono/zod-validator';
import {
  type LibraryFormat,
  cultureTypeForLibraryFormat,
  libraryCreateSchema,
  libraryDrawSchema,
  libraryFormatForCultureType,
  libraryStoreSchema,
  libraryUpdateSchema,
  reviveStatus,
  sourceTypeForLibraryFormat,
} from '@hyphaehub/core';
import {
  events,
  type HyphaeBatchItem,
  batches,
  costEntries,
  cultures,
  lineage,
  newId,
  strains,
} from '@hyphaehub/db';
import { and, desc, eq, inArray, or } from 'drizzle-orm';
import { Hono } from 'hono';
import { chunk, insertChunkSize } from '../lib/batch';
import { toDate, withDates } from '../lib/dates';
import { enforceLimit, getUsage } from '../lib/workspace';
import { requireAuth } from '../middleware/auth';
import type { AppEnv } from '../types';

type CultureRow = typeof cultures.$inferSelect;

const r = new Hono<AppEnv>();
r.use('*', requireAuth);

/** Attach the computed revive-by date + freshness to a stored culture row. */
function withRevive(row: typeof cultures.$inferSelect) {
  const { status, reviveBy } = reviveStatus(
    (row.libraryFormat ?? 'OTHER') as LibraryFormat,
    row.storedAt,
    row.lastRevivedAt,
  );
  return { ...row, reviveStatus: status, reviveBy: reviveBy ? reviveBy.toISOString() : null };
}

// The culture library / vault: every STORED culture, with viability + strain name.
r.get('/', async (c) => {
  const ws = c.var.workspace;
  const rows = await c.var.db
    .select()
    .from(cultures)
    .where(and(eq(cultures.workspaceId, ws.id), eq(cultures.status, 'STORED')))
    .orderBy(desc(cultures.storedAt));
  const strainIds = [...new Set(rows.map((x) => x.strainId).filter((x): x is string => !!x))];
  // Resolve names chunked (D1's 100-param cap) and workspace-scoped (+ presets) —
  // never leak a foreign workspace's strain name for an id a culture happens to carry.
  const strainName = new Map<string, string>();
  for (const group of chunk(strainIds, 90)) {
    if (!group.length) continue;
    const strainRows = await c.var.db
      .select({ id: strains.id, name: strains.commonName })
      .from(strains)
      .where(
        and(
          inArray(strains.id, group),
          or(eq(strains.workspaceId, ws.id), eq(strains.isPreset, true)),
        ),
      );
    for (const s of strainRows) strainName.set(s.id, s.name);
  }
  return c.json(
    rows.map((row) => ({
      ...withRevive(row),
      strainName: row.strainId ? (strainName.get(row.strainId) ?? null) : null,
    })),
  );
});

/** Add a purchased / standalone source straight into the library (e.g. a spore syringe). */
r.post('/', zValidator('json', libraryCreateSchema), async (c) => {
  const ws = c.var.workspace;
  const usage = await getUsage(c.var.db, ws.id);
  await enforceLimit(c.var.db, ws, 'maxCultures', usage.cultures);
  const d = c.req.valid('json');
  const type = cultureTypeForLibraryFormat(d.format);
  const [row] = await c.var.db
    .insert(cultures)
    .values({
      workspaceId: ws.id,
      batchId: null,
      strainId: d.strainId ?? null,
      type,
      sourceType: type === 'SOURCE' ? sourceTypeForLibraryFormat(d.format) : null,
      label: d.label,
      status: 'STORED',
      libraryFormat: d.format,
      storageMethod: d.storageMethod ?? null,
      storageLocation: d.storageLocation ?? null,
      storedAt: toDate(d.storedAt) ?? new Date(),
      quantity: d.quantity ?? null,
      quantityUnit: d.quantityUnit ?? null,
      notes: d.note ?? null,
    })
    .returning();
  if (!row) return c.json({ error: 'Could not create' }, 500);
  return c.json(withRevive(row), 201);
});

/** Move an existing culture into the library (status → STORED + storage fields). */
r.post('/:id/store', zValidator('json', libraryStoreSchema), async (c) => {
  const ws = c.var.workspace;
  const values = withDates(c.req.valid('json'), ['storedAt']);
  const [row] = await c.var.db
    .update(cultures)
    .set({
      status: 'STORED',
      libraryFormat: values.format,
      storageMethod: values.storageMethod ?? null,
      storageLocation: values.storageLocation ?? null,
      storedAt: values.storedAt ?? new Date(),
      lastRevivedAt: null,
      // Storing a culture takes it out of the contamination population, so clear
      // any stale contamination marks that would otherwise skew analytics.
      contaminatedAt: null,
      contaminantType: null,
      contaminationCause: null,
    })
    .where(and(eq(cultures.id, c.req.param('id')), eq(cultures.workspaceId, ws.id)))
    .returning();
  if (!row) return c.json({ error: 'Not found' }, 404);
  return c.json(withRevive(row));
});

/** Edit a stored culture's library fields. */
r.patch('/:id', zValidator('json', libraryUpdateSchema), async (c) => {
  const ws = c.var.workspace;
  const d = withDates(c.req.valid('json'), ['storedAt', 'lastRevivedAt']);
  const patch: Record<string, unknown> = {};
  if (d.format !== undefined) patch.libraryFormat = d.format;
  if (d.storageMethod !== undefined) patch.storageMethod = d.storageMethod;
  if (d.storageLocation !== undefined) patch.storageLocation = d.storageLocation;
  if (d.storedAt !== undefined) patch.storedAt = d.storedAt;
  if (d.lastRevivedAt !== undefined) patch.lastRevivedAt = d.lastRevivedAt;
  const where = and(
    eq(cultures.id, c.req.param('id')),
    eq(cultures.workspaceId, ws.id),
    eq(cultures.status, 'STORED'),
  );
  if (Object.keys(patch).length === 0) {
    // Nothing to change — avoid Drizzle's "No values to set" on an empty update.
    const [row] = await c.var.db.select().from(cultures).where(where).limit(1);
    if (!row) return c.json({ error: 'Not found' }, 404);
    return c.json(withRevive(row));
  }
  const [row] = await c.var.db.update(cultures).set(patch).where(where).returning();
  if (!row) return c.json({ error: 'Not found' }, 404);
  return c.json(withRevive(row));
});

/** Mark a stored culture freshly transferred — resets its viability clock. */
r.post('/:id/revive', async (c) => {
  const ws = c.var.workspace;
  const [row] = await c.var.db
    .update(cultures)
    .set({ lastRevivedAt: new Date() })
    .where(
      and(
        eq(cultures.id, c.req.param('id')),
        eq(cultures.workspaceId, ws.id),
        eq(cultures.status, 'STORED'),
      ),
    )
    .returning();
  if (!row) return c.json({ error: 'Not found' }, 404);
  return c.json(withRevive(row));
});

/** Retire a library culture entirely. Only acts on STORED cultures (library stock). */
r.delete('/:id', async (c) => {
  const ws = c.var.workspace;
  const rows = await c.var.db
    .delete(cultures)
    .where(
      and(
        eq(cultures.id, c.req.param('id')),
        eq(cultures.workspaceId, ws.id),
        eq(cultures.status, 'STORED'),
      ),
    )
    .returning({ id: cultures.id });
  if (!rows[0]) return c.json({ error: 'Not found' }, 404);
  return c.json({ ok: true });
});

/**
 * Draw N children from a stored library source — e.g. a spore syringe into several
 * grain jars in a grow batch, or into a liquid culture kept as library stock. The
 * source is reusable and never consumed. Records lineage, inoculation events, and
 * an optional per-child cost, all atomically.
 */
r.post('/:id/draw', zValidator('json', libraryDrawSchema), async (c) => {
  const ws = c.var.workspace;
  const db = c.var.db;
  const [source] = await db
    .select()
    .from(cultures)
    .where(
      and(
        eq(cultures.id, c.req.param('id')),
        eq(cultures.workspaceId, ws.id),
        eq(cultures.status, 'STORED'),
      ),
    )
    .limit(1);
  if (!source) return c.json({ error: 'Not found' }, 404);

  const d = c.req.valid('json');
  const toLibrary = d.destination === 'library';
  const inoculatedAt = toDate(d.inoculatedAt) ?? new Date();
  const usage = await getUsage(db, ws.id);

  // Resolve the destination batch: a new one, an existing one, or none (library stock).
  let batchId: string | null = null;
  let newBatchValues: typeof batches.$inferInsert | null = null;
  if (!toLibrary) {
    if (d.newBatchName) {
      await enforceLimit(db, ws, 'maxActiveBatches', usage.activeBatches);
      batchId = newId();
      newBatchValues = {
        id: batchId,
        workspaceId: ws.id,
        name: d.newBatchName,
        strainId: source.strainId,
        status: 'ACTIVE',
        startedAt: inoculatedAt,
      };
    } else if (d.batchId) {
      const [b] = await db
        .select({ id: batches.id })
        .from(batches)
        .where(and(eq(batches.id, d.batchId), eq(batches.workspaceId, ws.id)))
        .limit(1);
      if (!b) return c.json({ error: 'Batch not found' }, 404);
      batchId = b.id;
    }
  }

  await enforceLimit(db, ws, 'maxCultures', usage.cultures, d.count);

  const libFormat: LibraryFormat | null = toLibrary
    ? (d.libraryFormat ?? libraryFormatForCultureType(d.type))
    : null;
  const childSourceType =
    d.type === 'SOURCE' && libFormat ? sourceTypeForLibraryFormat(libFormat) : null;
  const prefix = d.labelPrefix ?? source.label;

  const childRows = Array.from({ length: d.count }, (_, i) => ({
    id: newId(),
    workspaceId: ws.id,
    batchId,
    strainId: source.strainId,
    type: d.type,
    sourceType: childSourceType,
    label: d.count > 1 ? `${prefix}-${i + 1}` : prefix,
    status: toLibrary ? ('STORED' as const) : ('INOCULATED' as const),
    containerType: d.containerType,
    substrateType: d.substrateType ?? null,
    quantity: d.quantity ?? null,
    quantityUnit: d.quantityUnit ?? null,
    inoculatedAt,
    libraryFormat: libFormat,
    storageLocation: toLibrary ? (d.storageLocation ?? null) : null,
    storedAt: toLibrary ? inoculatedAt : null,
  }));
  const lineageRows = childRows.map((ch) => ({
    workspaceId: ws.id,
    parentCultureId: source.id,
    childCultureId: ch.id,
  }));
  const eventRows = childRows.map((ch) => ({
    workspaceId: ws.id,
    cultureId: ch.id,
    batchId,
    type: 'INOCULATION' as const,
    occurredAt: inoculatedAt,
    note: `Drawn from ${source.label}`,
  }));
  const cpc = d.costPerChildCents;
  const costRows = cpc
    ? childRows.map((ch) => ({
        workspaceId: ws.id,
        batchId,
        cultureId: ch.id,
        description: `${ch.label} materials`,
        category: 'MATERIALS' as const,
        amountCents: cpc,
        occurredAt: inoculatedAt,
      }))
    : [];

  // One atomic batch: the new batch first (children reference it), then children
  // (lineage/events/costs reference them), each insert chunked under D1's param cap.
  const head: HyphaeBatchItem[] = newBatchValues
    ? [db.insert(batches).values(newBatchValues).returning()]
    : [];
  // 16 explicit columns + created_at/updated_at ($defaultFn, bound per row) = 18.
  const cultureInserts = chunk(childRows, insertChunkSize(18)).map((rows) =>
    db.insert(cultures).values(rows).returning(),
  );
  const writes: HyphaeBatchItem[] = [
    ...head,
    ...cultureInserts,
    ...chunk(lineageRows, insertChunkSize(5)).map((rows) => db.insert(lineage).values(rows)),
    ...chunk(eventRows, insertChunkSize(8)).map((rows) => db.insert(events).values(rows)),
    ...chunk(costRows, insertChunkSize(9)).map((rows) => db.insert(costEntries).values(rows)),
  ];
  const results = await db.batch(writes as [HyphaeBatchItem, ...HyphaeBatchItem[]]);
  const batch = newBatchValues
    ? ((results[0] as (typeof batches.$inferSelect)[])[0] ?? newBatchValues)
    : null;
  const created = (
    results.slice(head.length, head.length + cultureInserts.length) as CultureRow[][]
  ).flat();

  return c.json({ source, batch, children: created }, 201);
});

export default r;
