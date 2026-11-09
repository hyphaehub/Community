import { zValidator } from '@hono/zod-validator';
import {
  type BatchActuals,
  DEFAULT_FORECAST_PROFILE,
  aggregateCalendar,
  buildReminders,
  deriveActuals,
  forecastProfileSettingsSchema,
  learnProfileFromHistory,
  remindersToICS,
  resolveForecastProfile,
} from '@hyphaehub/core';
import { events, batches, cultures, harvests, newId, strains, workspaces } from '@hyphaehub/db';
import { and, eq, or } from 'drizzle-orm';
import { Hono } from 'hono';
import { toDate } from '../lib/dates';
import { buildForecasts, loadBatchData } from '../lib/forecast';
import { requireAuth } from '../middleware/auth';
import type { AppEnv } from '../types';

const r = new Hono<AppEnv>();
r.use('*', requireAuth);

const DAY_MS = 86_400_000;

// Workspace-level forecast base times (the editable defaults behind every batch).
r.get('/profile', (c) => {
  const ws = c.var.workspace;
  const p = resolveForecastProfile(ws.forecastProfile ?? null);
  return c.json({
    durations: p.durations,
    flushes: p.flushes,
    isCustom: !!ws.forecastProfile,
    // Learned per-stage spread (±days) + how many runs informed it, for a confidence readout.
    stats: p.durationStats ?? null,
    samples: p.samples ?? 0,
    defaults: {
      durations: DEFAULT_FORECAST_PROFILE.durations,
      flushes: DEFAULT_FORECAST_PROFILE.flushes,
    },
  });
});

r.patch('/profile', zValidator('json', forecastProfileSettingsSchema), async (c) => {
  const ws = c.var.workspace;
  const d = c.req.valid('json');
  // Layer the manual base-time edit onto the stored profile so it overrides only the
  // centers the user changed — the learned spread, yields, and sample count survive.
  const stored = resolveForecastProfile(ws.forecastProfile ?? null);
  const profile = resolveForecastProfile(
    {
      durations: {
        colonization: d.colonization,
        bulkColonization: d.bulkColonization,
        firstFlush: d.firstFlush,
        flushGap: d.flushGap,
      },
      flushes: d.flushes,
      samples: stored.samples,
      updatedAt: stored.updatedAt,
    },
    stored,
  );
  const [row] = await c.var.db
    .update(workspaces)
    .set({ forecastProfile: profile })
    .where(eq(workspaces.id, ws.id))
    .returning();
  const p = resolveForecastProfile(row?.forecastProfile ?? null);
  return c.json({ durations: p.durations, flushes: p.flushes, isCustom: true });
});

/**
 * Learn the workspace base times from the grower's OWN completed-batch history —
 * a data-driven alternative to the hand-entered defaults. Improves predictions
 * for new batches and for strains without their own learned profile.
 */
r.post('/profile/learn', async (c) => {
  const ws = c.var.workspace;
  const batchRows = await c.var.db
    .select()
    .from(batches)
    .where(and(eq(batches.workspaceId, ws.id), eq(batches.status, 'COMPLETED')));
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
  const { profile, samples } = learnProfileFromHistory(history, ws.forecastProfile ?? null);
  if (samples > 0) {
    await c.var.db
      .update(workspaces)
      .set({ forecastProfile: profile })
      .where(eq(workspaces.id, ws.id));
  }
  const p = resolveForecastProfile(samples > 0 ? profile : (ws.forecastProfile ?? null));
  return c.json({
    durations: p.durations,
    flushes: p.flushes,
    isCustom: samples > 0 || !!ws.forecastProfile,
    samples,
    saved: samples > 0,
  });
});

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

// Actionable reminders: upcoming/overdue life-stage transitions across batches.
r.get('/reminders', async (c) => {
  const ws = c.var.workspace;
  const now = new Date();
  const horizonDays = Number(c.req.query('horizonDays')) || 21;
  const batchRows = await c.var.db.select().from(batches).where(eq(batches.workspaceId, ws.id));
  const forecasts = await buildForecasts(c.var.db, ws.id, batchRows, now);
  return c.json({ reminders: buildReminders(forecasts, { now, horizonDays }) });
});

// iCalendar feed of upcoming transitions — import/subscribe in Google/Apple Calendar.
r.get('/calendar.ics', async (c) => {
  const ws = c.var.workspace;
  const now = new Date();
  const batchRows = await c.var.db.select().from(batches).where(eq(batches.workspaceId, ws.id));
  const forecasts = await buildForecasts(c.var.db, ws.id, batchRows, now);
  const reminders = buildReminders(forecasts, { now, horizonDays: 120 });
  const ics = remindersToICS(reminders, { stamp: now, calendarName: `${ws.name} · HyphaeHub` });
  return c.body(ics, 200, {
    'content-type': 'text/calendar; charset=utf-8',
    'content-disposition': 'attachment; filename="hyphaehub-schedule.ics"',
  });
});

// Calendar subscription: mint (or return) the workspace's secret token for the
// public auto-refreshing feed at /api/ical/:token/schedule.ics.
r.post('/subscription', async (c) => {
  const ws = c.var.workspace;
  let token = ws.calendarToken;
  if (!token) {
    token = newId();
    await c.var.db.update(workspaces).set({ calendarToken: token }).where(eq(workspaces.id, ws.id));
  }
  return c.json({ path: `/api/ical/${token}/schedule.ics` });
});

// Rotate the token — old subscription links stop working.
r.post('/subscription/rotate', async (c) => {
  const ws = c.var.workspace;
  const token = newId();
  await c.var.db.update(workspaces).set({ calendarToken: token }).where(eq(workspaces.id, ws.id));
  return c.json({ path: `/api/ical/${token}/schedule.ics` });
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
    .where(
      and(
        eq(batches.workspaceId, ws.id),
        eq(batches.strainId, id),
        eq(batches.status, 'COMPLETED'),
      ),
    );
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

  // Shrink toward the resolved workspace base (DEFAULT ← workspace), and fall back to
  // the strain's own existing values for stages it hasn't observed — keeping each
  // stage's center and spread on the same layer.
  const workspaceBase = resolveForecastProfile(ws.forecastProfile ?? null);
  const { profile, samples } = learnProfileFromHistory(
    history,
    strain.forecastProfile ?? null,
    workspaceBase,
  );

  // Presets are global; a learned profile can only be persisted onto an org's own strain.
  const canSave = samples > 0 && strain.workspaceId === ws.id;
  if (canSave) {
    await c.var.db.update(strains).set({ forecastProfile: profile }).where(eq(strains.id, id));
  }

  return c.json({ profile, samples, saved: canSave });
});

export default r;
