import { buildReminders, remindersToICS } from '@hyphaehub/core';
import { workspaces } from '@hyphaehub/db';
import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { workspaceForecasts } from '../lib/forecast';
import type { AppEnv } from '../types';

/**
 * PUBLIC calendar feed — no session required, so Google/Apple/Outlook can
 * subscribe and auto-refresh. The unguessable token in the URL is the capability
 * (mint/rotate it from POST /api/forecast/subscription). It only exposes the
 * grow schedule (batch names + predicted dates), nothing else.
 */
const r = new Hono<AppEnv>();

r.get('/:token/schedule.ics', async (c) => {
  const token = c.req.param('token');
  if (!token) return c.text('Not found', 404);
  const [ws] = await c.var.db
    .select()
    .from(workspaces)
    .where(eq(workspaces.calendarToken, token))
    .limit(1);
  if (!ws) return c.text('Not found', 404);

  const now = new Date();
  const forecasts = await workspaceForecasts(c.var.db, ws.id, now);
  const reminders = buildReminders(forecasts, { now, horizonDays: 120 });
  const ics = remindersToICS(reminders, { stamp: now, calendarName: `${ws.name} · HyphaeHub` });
  return c.body(ics, 200, {
    'content-type': 'text/calendar; charset=utf-8',
    'cache-control': 'public, max-age=1800',
  });
});

export default r;
