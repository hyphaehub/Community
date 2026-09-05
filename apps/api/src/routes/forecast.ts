import {
  type BatchActuals,
  type BatchForecast,
  DEFAULT_FORECAST_PROFILE,
  type ForecastProfile,
  aggregateCalendar,
  deriveActuals,
  learnProfileFromHistory,
  predictBatchTimeline,
  resolveForecastProfile,
} from '@hyphaehub/core';
import {
  events,
  type Batch,
  type HyphaeDB,
  batches,
  cultures,
  harvests,
  strains,
} from '@hyphaehub/db';
import { and, eq, inArray, or } from 'drizzle-orm';
import { Hono } from 'hono';
import { toDate } from '../lib/dates';
import { requireAuth } from '../middleware/auth';
import type { AppEnv } from '../types';

const r = new Hono<AppEnv>();
r.use('*', requireAuth);

const DAY_MS = 86_400_000;

/** Bulk-load the per-batch rows a forecast needs and index them by batch id. */
async function loadBatchData(db: HyphaeDB, workspaceId: string, batchRows: Batch[]) {
  const ids = batchRows.map((b) => b.id);
  if (ids.length === 0) {
    return {
      culturesByBatch: new Map(),
      eventsByBatch: new Map(),
      harvestsByBatch: new Map(),
      strainById: new Map<string, ForecastProfile | null>(),
    };
  }
  const [cultureRows, eventRows, harvestRows] = await Promise.all([
    db
      .select()
      .from(cultures)
      .where(and(eq(cultures.workspaceId, workspaceId), inArray(cultures.batchId, ids))),
    db
      .select()
      .from(events)
      .where(and(eq(events.workspaceId, workspaceId), inArray(events.batchId, ids))),
    db
      .select()
      .from(harvests)
      .where(and(eq(harvests.workspaceId, workspaceId), inArray(harvests.batchId, ids))),
  ]);

  const strainIds = [...new Set(batchRows.map((b) => b.strainId).filter((x): x is string => !!x))];
  const strainRows = strainIds.length
    ? await db
        .select({ id: strains.id, forecastProfile: strains.forecastProfile })
        .from(strains)
        .where(inArray(strains.id, strainIds))
    : [];

  const group = <T extends { batchId: string | null }>(rows: T[]) => {
    const m = new Map<string, T[]>();
    for (const row of rows) {
      if (!row.batchId) continue;
      const list = m.get(row.batchId) ?? [];
      list.push(row);
      m.set(row.batchId, list);
    }
    return m;
  };

  return {
    culturesByBatch: group(cultureRows),
    eventsByBatch: group(eventRows),
    harvestsByBatch: group(harvestRows),
    strainById: new Map(strainRows.map((s) => [s.id, s.forecastProfile])),
  };
}

/** A per-batch forecast plus the resolved profile that produced it. */
type BatchForecastWithProfile = BatchForecast & { profile: ForecastProfile };

/** Build re-anchored timelines for a set of batches. */
async function buildForecasts(
  db: HyphaeDB,
  workspaceId: string,
  batchRows: Batch[],
  now: Date,
): Promise<BatchForecastWithProfile[]> {
  const data = await loadBatchData(db, workspaceId, batchRows);
  return batchRows.map((b) => {
    const profile = resolveForecastProfile(data.strainById.get(b.strainId ?? '') ?? null);
    const actuals = deriveActuals({
      events: data.eventsByBatch.get(b.id) ?? [],
      harvests: data.harvestsByBatch.get(b.id) ?? [],
      cultures: data.culturesByBatch.get(b.id) ?? [],
      batch: { startedAt: b.startedAt, status: b.status },
    });
    const { anchorAt, timeline, ended } = predictBatchTimeline({
      actuals,
      profile,
      goalDryWeightG: b.goalDryWeightG,
      batchStatus: b.status,
      now,
    });
    return {
      batchId: b.id,
      batchName: b.name,
      strainId: b.strainId,
      anchorAt,
      ended,
      timeline,
      profile,
    };
  });
}

// One batch's predicted-vs-actual timeline.
r.get('/batch/:id', async (c) => {
  const ws = c.var.workspace;
  const [batch] = await c.var.db
    .select()
    .from(batches)
    .where(and(eq(batches.id, c.req.param('id')), eq(batches.workspaceId, ws.id)))
    .limit(1);
  if (!batch) return c.json({ error: 'Not found' }, 404);
  const [forecast] = await buildForecasts(c.var.db, ws.id, [batch], new Date());
  return c.json(forecast);
});

// Workspace-wide production calendar over a window (defaults to now-7d .. now+56d).
r.get('/calendar', async (c) => {
  const ws = c.var.workspace;
  const now = new Date();
  const from = toDate(c.req.query('from')) ?? new Date(now.getTime() - 7 * DAY_MS);
  const to = toDate(c.req.query('to')) ?? new Date(now.getTime() + 56 * DAY_MS);

  const batchRows = await c.var.db.select().from(batches).where(eq(batches.workspaceId, ws.id));
  const forecasts = await buildForecasts(c.var.db, ws.id, batchRows, now);
  const calendar = aggregateCalendar(forecasts, {
    from,
    to,
    now,
    profile: DEFAULT_FORECAST_PROFILE,
  });

  return c.json({
    ...calendar,
    batches: forecasts.map((f) => ({
      batchId: f.batchId,
      batchName: f.batchName,
      strainId: f.strainId,
      anchorAt: f.anchorAt,
      ended: f.ended,
    })),
  });
});

// Refine a strain's forecast profile from its own completed-batch history.
r.post('/strains/:id/learn', async (c) => {
  const ws = c.var.workspace;
  const id = c.req.param('id');
  const [strain] = await c.var.db
    .select()
    .from(strains)
    .where(and(eq(strains.id, id), or(eq(strains.workspaceId, ws.id), eq(strains.isPreset, true))))
    .limit(1);
  if (!strain) return c.json({ error: 'Not found' }, 404);

  const batchRows = await c.var.db
    .select()
    .from(batches)
    .where(and(eq(batches.workspaceId, ws.id), eq(batches.strainId, id)));
  const data = await loadBatchData(c.var.db, ws.id, batchRows);

  const history: { actuals: BatchActuals; goalDryWeightG?: number | null }[] = batchRows.map(
    (b) => ({
      actuals: deriveActuals({
        events: data.eventsByBatch.get(b.id) ?? [],
        harvests: data.harvestsByBatch.get(b.id) ?? [],
        cultures: data.culturesByBatch.get(b.id) ?? [],
        batch: { startedAt: b.startedAt, status: b.status },
      }),
      goalDryWeightG: b.goalDryWeightG,
    }),
  );

  const { profile, samples } = learnProfileFromHistory(history, strain.forecastProfile ?? null);

  // Presets are global; a learned profile can only be persisted onto an org's own strain.
  const canSave = samples > 0 && strain.workspaceId === ws.id;
  if (canSave) {
    await c.var.db.update(strains).set({ forecastProfile: profile }).where(eq(strains.id, id));
  }

  return c.json({ profile, samples, saved: canSave });
});

export default r;
