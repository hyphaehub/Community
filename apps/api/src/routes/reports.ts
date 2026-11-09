import { biologicalEfficiency } from '@hyphaehub/core';
import { cultures, harvests, strains } from '@hyphaehub/db';
import { eq, isNull, or } from 'drizzle-orm';
import { Hono } from 'hono';
import { requireAuth } from '../middleware/auth';
import type { AppEnv } from '../types';

const r = new Hono<AppEnv>();
r.use('*', requireAuth);

type Bucket = { total: number; contaminated: number };
type Breakdown = { key: string; label: string; total: number; contaminated: number; rate: number };

/** Roll a set of {key,label} rows into rate breakdowns, sorted by volume. */
function breakdown(
  rows: { key: string | null; label: string; contaminated: boolean }[],
): Breakdown[] {
  const map = new Map<string, Bucket & { label: string }>();
  for (const row of rows) {
    const key = row.key ?? '__none__';
    const b = map.get(key) ?? { total: 0, contaminated: 0, label: row.label };
    b.total += 1;
    if (row.contaminated) b.contaminated += 1;
    map.set(key, b);
  }
  return [...map.entries()]
    .map(([key, b]) => ({
      key,
      label: b.label,
      total: b.total,
      contaminated: b.contaminated,
      rate: b.total ? b.contaminated / b.total : 0,
    }))
    .sort((a, b) => b.total - a.total);
}

/** Count occurrences of a nullable dimension across the contaminated rows only. */
function tally(values: (string | null | undefined)[]): { key: string; count: number }[] {
  const map = new Map<string, number>();
  for (const v of values) {
    const key = v ?? 'UNKNOWN';
    map.set(key, (map.get(key) ?? 0) + 1);
  }
  return [...map.entries()]
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => b.count - a.count);
}

/**
 * Contamination-rate analytics: overall rate plus breakdowns by stage, strain,
 * and substrate, and a tally of contaminant types and suspected causes. The data
 * comes straight from the culture graph — HyphaeHub's structural advantage.
 */
r.get('/contamination', async (c) => {
  const ws = c.var.workspace;
  const rows = await c.var.db
    .select({
      id: cultures.id,
      label: cultures.label,
      type: cultures.type,
      status: cultures.status,
      strainId: cultures.strainId,
      substrateType: cultures.substrateType,
      contaminantType: cultures.contaminantType,
      contaminationCause: cultures.contaminationCause,
      contaminatedAt: cultures.contaminatedAt,
      batchId: cultures.batchId,
    })
    .from(cultures)
    .where(eq(cultures.workspaceId, ws.id));

  const strainRows = await c.var.db
    .select({ id: strains.id, name: strains.commonName })
    .from(strains)
    .where(or(eq(strains.workspaceId, ws.id), isNull(strains.workspaceId)));
  const strainName = new Map(strainRows.map((s) => [s.id, s.name]));

  const isContam = (s: string) => s === 'CONTAMINATED';
  const total = rows.length;
  const contaminatedRows = rows.filter((x) => isContam(x.status));

  const byStage = breakdown(
    rows.map((x) => ({ key: x.type, label: x.type, contaminated: isContam(x.status) })),
  );
  const byStrain = breakdown(
    rows.map((x) => ({
      key: x.strainId,
      label: x.strainId ? (strainName.get(x.strainId) ?? 'Unknown strain') : 'No strain',
      contaminated: isContam(x.status),
    })),
  );
  const bySubstrate = breakdown(
    rows.map((x) => ({
      // Coalesce '' and null into one bucket so they don't render as two "Unspecified" rows.
      key: x.substrateType || null,
      label: x.substrateType || 'Unspecified',
      contaminated: isContam(x.status),
    })),
  );

  return c.json({
    overall: {
      total,
      contaminated: contaminatedRows.length,
      rate: total ? contaminatedRows.length / total : 0,
    },
    byStage,
    byStrain,
    bySubstrate,
    byContaminant: tally(contaminatedRows.map((x) => x.contaminantType)),
    byCause: tally(contaminatedRows.map((x) => x.contaminationCause)),
    recent: contaminatedRows
      .slice()
      .sort((a, b) => Number(b.contaminatedAt ?? 0) - Number(a.contaminatedAt ?? 0))
      .slice(0, 25)
      .map((x) => ({
        id: x.id,
        label: x.label,
        type: x.type,
        batchId: x.batchId,
        contaminantType: x.contaminantType,
        contaminationCause: x.contaminationCause,
        contaminatedAt: x.contaminatedAt,
      })),
  });
});

/**
 * Per-strain performance leaderboard: rank the grower's own genetics by yield,
 * biological efficiency, and contamination rate (reuses cultures + harvests).
 */
r.get('/strains', async (c) => {
  const ws = c.var.workspace;
  const [cultureRows, harvestRows, strainRows] = await Promise.all([
    c.var.db
      .select({
        id: cultures.id,
        strainId: cultures.strainId,
        type: cultures.type,
        status: cultures.status,
        drySubstrateG: cultures.drySubstrateG,
      })
      .from(cultures)
      .where(eq(cultures.workspaceId, ws.id)),
    c.var.db
      .select({
        cultureId: harvests.cultureId,
        wetWeightG: harvests.wetWeightG,
        dryWeightG: harvests.dryWeightG,
      })
      .from(harvests)
      .where(eq(harvests.workspaceId, ws.id)),
    c.var.db
      .select({ id: strains.id, name: strains.commonName })
      .from(strains)
      .where(or(eq(strains.workspaceId, ws.id), isNull(strains.workspaceId))),
  ]);

  const strainName = new Map(strainRows.map((s) => [s.id, s.name]));
  const cultureStrain = new Map(cultureRows.map((x) => [x.id, x.strainId]));
  type Agg = { cultures: number; contaminated: number; wet: number; dry: number; drySub: number };
  const by = new Map<string, Agg>();
  const bump = (sid: string) => {
    const a = by.get(sid) ?? { cultures: 0, contaminated: 0, wet: 0, dry: 0, drySub: 0 };
    by.set(sid, a);
    return a;
  };
  for (const x of cultureRows) {
    if (!x.strainId) continue;
    const a = bump(x.strainId);
    a.cultures += 1;
    if (x.status === 'CONTAMINATED') a.contaminated += 1;
    if (x.type === 'BULK') a.drySub += x.drySubstrateG ?? 0;
  }
  for (const h of harvestRows) {
    const sid = cultureStrain.get(h.cultureId);
    if (!sid) continue;
    const a = bump(sid);
    a.wet += h.wetWeightG ?? 0;
    a.dry += h.dryWeightG ?? 0;
  }

  const rows = [...by.entries()]
    .map(([strainId, a]) => ({
      strainId,
      name: strainName.get(strainId) ?? 'Unknown strain',
      cultures: a.cultures,
      contaminated: a.contaminated,
      contamRate: a.cultures ? a.contaminated / a.cultures : 0,
      totalWetG: a.wet,
      totalDryG: a.dry,
      biologicalEfficiency: biologicalEfficiency(a.wet, a.drySub || null),
    }))
    .sort((x, y) => y.totalDryG - x.totalDryG || x.contamRate - y.contamRate);

  return c.json({ strains: rows });
});

export default r;
