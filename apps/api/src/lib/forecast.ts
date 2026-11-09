import {
  type BatchForecast,
  type ForecastProfile,
  deriveActuals,
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
  workspaces,
} from '@hyphaehub/db';
import { and, eq, inArray } from 'drizzle-orm';

/** Bulk-load the per-batch rows a forecast needs and index them by batch id. */
export async function loadBatchData(db: HyphaeDB, workspaceId: string, batchRows: Batch[]) {
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
export type BatchForecastWithProfile = BatchForecast & { profile: ForecastProfile };

/** Build re-anchored timelines for a set of batches. */
export async function buildForecasts(
  db: HyphaeDB,
  workspaceId: string,
  batchRows: Batch[],
  now: Date,
): Promise<BatchForecastWithProfile[]> {
  const data = await loadBatchData(db, workspaceId, batchRows);
  // Workspace-level base times (Settings) sit between the built-in defaults and
  // any per-strain learned profile.
  const [wsRow] = await db
    .select({ forecastProfile: workspaces.forecastProfile })
    .from(workspaces)
    .where(eq(workspaces.id, workspaceId))
    .limit(1);
  const workspaceBase = resolveForecastProfile(wsRow?.forecastProfile ?? null);
  return batchRows.map((b) => {
    const profile = resolveForecastProfile(
      data.strainById.get(b.strainId ?? '') ?? null,
      workspaceBase,
    );
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

/** All batches for a workspace + their forecasts (the common calendar/reminder query). */
export async function workspaceForecasts(db: HyphaeDB, workspaceId: string, now: Date) {
  const batchRows = await db.select().from(batches).where(eq(batches.workspaceId, workspaceId));
  return buildForecasts(db, workspaceId, batchRows, now);
}
