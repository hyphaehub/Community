import { zValidator } from '@hono/zod-validator';
import {
  buyerInviteSchema,
  listingCreateSchema,
  listingUpdateSchema,
  storefrontSettingsSchema,
} from '@hyphaehub/core';
import {
  buyerTokens,
  buyers,
  dibs,
  listings,
  strainVotes,
  strains,
  workspaces,
} from '@hyphaehub/db';
import { and, desc, eq, inArray, or } from 'drizzle-orm';
import { type Context, Hono } from 'hono';
import { chunk } from '../lib/batch';
import { withDates } from '../lib/dates';
import { buyerInviteEmail, sendEmail } from '../lib/email';
import { LOGIN_TOKEN_TTL_MS, generateToken, sha256hex } from '../lib/portal';
import { requireAuth, requireFeature, requirePlan } from '../middleware/auth';
import type { AppEnv } from '../types';

const r = new Hono<AppEnv>();
r.use('*', requireAuth);
// The buyer storefront is a FARM-tier (highest paid plan) feature.
r.use('*', requirePlan('FARM'));

const appBase = (c: { env: AppEnv['Bindings'] }) => c.env.APP_URL ?? 'https://app.hyphaehub.io';
const inviteUrl = (c: { env: AppEnv['Bindings'] }, token: string) =>
  `${appBase(c)}/portal/enter?token=${token}`;

/** Mint a fresh magic-link for a buyer, email it via Resend, and return the URL. */
async function mintInvite(
  c: Context<AppEnv>,
  buyer: { id: string; workspaceId: string; email: string },
) {
  const token = generateToken();
  await c.var.db.insert(buyerTokens).values({
    buyerId: buyer.id,
    workspaceId: buyer.workspaceId,
    tokenHash: await sha256hex(token),
    purpose: 'LOGIN',
    expiresAt: new Date(Date.now() + LOGIN_TOKEN_TTL_MS),
  });
  const url = inviteUrl(c, token);
  const mail = buyerInviteEmail(c.var.workspace.name, url);
  const { sent } = await sendEmail(c.env, { to: buyer.email, ...mail });
  return { inviteUrl: url, emailed: sent };
}

// ── Storefront settings ───────────────────────────────────────────────────────
r.get('/settings', (c) => {
  const ws = c.var.workspace;
  return c.json({
    enabled: ws.storefrontEnabled,
    showForecast: ws.storefrontShowForecast,
    forecastDays: ws.storefrontForecastDays,
    blurb: ws.storefrontBlurb,
    name: ws.name,
  });
});

r.patch('/settings', zValidator('json', storefrontSettingsSchema), async (c) => {
  const ws = c.var.workspace;
  const d = c.req.valid('json');
  const patch: Record<string, unknown> = {};
  if (d.enabled !== undefined) patch.storefrontEnabled = d.enabled;
  if (d.showForecast !== undefined) patch.storefrontShowForecast = d.showForecast;
  if (d.forecastDays !== undefined) patch.storefrontForecastDays = d.forecastDays;
  if (d.blurb !== undefined) patch.storefrontBlurb = d.blurb;
  const [row] = await c.var.db
    .update(workspaces)
    .set(patch)
    .where(eq(workspaces.id, ws.id))
    .returning();
  // Return only the storefront fields (never the full row: it carries the calendar
  // token and Stripe ids).
  return c.json({
    enabled: row?.storefrontEnabled ?? false,
    showForecast: row?.storefrontShowForecast ?? false,
    forecastDays: row?.storefrontForecastDays ?? 21,
    blurb: row?.storefrontBlurb ?? null,
    name: row?.name ?? ws.name,
  });
});

// ── Buyers (invite / list / remove) ───────────────────────────────────────────
r.get('/buyers', async (c) => {
  const ws = c.var.workspace;
  const rows = await c.var.db
    .select()
    .from(buyers)
    .where(eq(buyers.workspaceId, ws.id))
    .orderBy(desc(buyers.createdAt));
  return c.json(rows);
});

/** Invite a buyer: create (or reuse) the buyer, mint a magic-link, return the URL. */
r.post('/buyers', zValidator('json', buyerInviteSchema), async (c) => {
  const ws = c.var.workspace;
  const { email, name } = c.req.valid('json');
  const normEmail = email.trim().toLowerCase();

  const existing = await c.var.db
    .select()
    .from(buyers)
    .where(and(eq(buyers.workspaceId, ws.id), eq(buyers.email, normEmail)))
    .limit(1);
  let buyer = existing[0];
  if (!buyer) {
    const rows = await c.var.db
      .insert(buyers)
      .values({ workspaceId: ws.id, email: normEmail, name: name ?? null })
      .returning();
    buyer = rows[0];
  } else if (name && !buyer.name) {
    await c.var.db.update(buyers).set({ name }).where(eq(buyers.id, buyer.id));
  }
  if (!buyer) return c.json({ error: 'Could not create buyer' }, 500);

  const invite = await mintInvite(c, buyer);
  return c.json({ buyer, ...invite }, 201);
});

/** Regenerate a fresh magic-link for an existing buyer. */
r.post('/buyers/:id/invite', async (c) => {
  const ws = c.var.workspace;
  const rows = await c.var.db
    .select()
    .from(buyers)
    .where(and(eq(buyers.id, c.req.param('id')), eq(buyers.workspaceId, ws.id)))
    .limit(1);
  const buyer = rows[0];
  if (!buyer) return c.json({ error: 'Not found' }, 404);
  const invite = await mintInvite(c, buyer);
  return c.json(invite);
});

r.delete('/buyers/:id', async (c) => {
  const ws = c.var.workspace;
  const rows = await c.var.db
    .delete(buyers)
    .where(and(eq(buyers.id, c.req.param('id')), eq(buyers.workspaceId, ws.id)))
    .returning({ id: buyers.id });
  if (!rows[0]) return c.json({ error: 'Not found' }, 404);
  return c.json({ ok: true });
});

// ── Listings (harvested product offered for sale) ─────────────────────────────
r.get('/listings', async (c) => {
  const ws = c.var.workspace;
  const rows = await c.var.db
    .select()
    .from(listings)
    .where(eq(listings.workspaceId, ws.id))
    .orderBy(desc(listings.createdAt));
  return c.json(rows);
});

r.post('/listings', zValidator('json', listingCreateSchema), async (c) => {
  const ws = c.var.workspace;
  const values = withDates(c.req.valid('json'), ['availableAt']);
  const rows = await c.var.db
    .insert(listings)
    .values({ ...values, workspaceId: ws.id })
    .returning();
  return c.json(rows[0], 201);
});

r.patch('/listings/:id', zValidator('json', listingUpdateSchema), async (c) => {
  const ws = c.var.workspace;
  const values = withDates(c.req.valid('json'), ['availableAt']);
  const rows = await c.var.db
    .update(listings)
    .set(values)
    .where(and(eq(listings.id, c.req.param('id')), eq(listings.workspaceId, ws.id)))
    .returning();
  if (!rows[0]) return c.json({ error: 'Not found' }, 404);
  return c.json(rows[0]);
});

r.delete('/listings/:id', async (c) => {
  const ws = c.var.workspace;
  const rows = await c.var.db
    .delete(listings)
    .where(and(eq(listings.id, c.req.param('id')), eq(listings.workspaceId, ws.id)))
    .returning({ id: listings.id });
  if (!rows[0]) return c.json({ error: 'Not found' }, 404);
  return c.json({ ok: true });
});

// ── Dibs (incoming reservation requests; farm approves/declines) ──────────────
r.get('/dibs', async (c) => {
  const ws = c.var.workspace;
  const rows = await c.var.db
    .select()
    .from(dibs)
    .where(eq(dibs.workspaceId, ws.id))
    .orderBy(desc(dibs.createdAt));
  // Hydrate with buyer + listing labels for the farm's queue.
  const buyerIds = [...new Set(rows.map((d) => d.buyerId))];
  const listingIds = [...new Set(rows.map((d) => d.listingId).filter((x): x is string => !!x))];
  const buyerRows = buyerIds.length
    ? await c.var.db.select().from(buyers).where(inArray(buyers.id, buyerIds))
    : [];
  const listingRows = listingIds.length
    ? await c.var.db.select().from(listings).where(inArray(listings.id, listingIds))
    : [];
  const buyerById = new Map(buyerRows.map((b) => [b.id, b]));
  const listingById = new Map(listingRows.map((l) => [l.id, l]));
  return c.json(
    rows.map((d) => ({
      ...d,
      buyer: buyerById.get(d.buyerId) ?? null,
      listing: d.listingId ? (listingById.get(d.listingId) ?? null) : null,
    })),
  );
});

/**
 * Approve or decline a dib. Reservations are "soft" — the farm decides, and the
 * storefront clamps displayed availability at zero — so approvals aren't hard-
 * capped at remaining stock here (the farmer can deliberately over-commit).
 */
async function setDibStatus(c: Context<AppEnv>, id: string, status: 'APPROVED' | 'DECLINED') {
  const ws = c.var.workspace;
  const rows = await c.var.db
    .update(dibs)
    .set({ status })
    .where(and(eq(dibs.id, id), eq(dibs.workspaceId, ws.id)))
    .returning();
  if (!rows[0]) return c.json({ error: 'Not found' }, 404);
  return c.json(rows[0]);
}
r.post('/dibs/:id/approve', (c) => setDibStatus(c, c.req.param('id'), 'APPROVED'));
r.post('/dibs/:id/decline', (c) => setDibStatus(c, c.req.param('id'), 'DECLINED'));

// ── Strain voting: how buyers ranked which library strain to grow next ────────
// Per-route feature gate (NOT file-wide, so it can't 404 the existing listings/dibs).
r.get('/votes', requireFeature('strainVoting'), async (c) => {
  const ws = c.var.workspace;
  const rows = await c.var.db
    .select({ strainId: strainVotes.strainId })
    .from(strainVotes)
    .where(eq(strainVotes.workspaceId, ws.id));
  const tally = new Map<string, number>();
  for (const v of rows) tally.set(v.strainId, (tally.get(v.strainId) ?? 0) + 1);
  const strainIds = [...tally.keys()];
  const nameById = new Map<string, string>();
  for (const group of chunk(strainIds, 90)) {
    if (!group.length) continue;
    const srows = await c.var.db
      .select({ id: strains.id, name: strains.commonName })
      .from(strains)
      .where(
        and(
          inArray(strains.id, group),
          or(eq(strains.workspaceId, ws.id), eq(strains.isPreset, true)),
        ),
      );
    for (const s of srows) nameById.set(s.id, s.name);
  }
  const tallies = strainIds
    .map((id) => ({
      strainId: id,
      name: nameById.get(id) ?? 'Unknown strain',
      votes: tally.get(id) ?? 0,
    }))
    .sort((a, b) => b.votes - a.votes || a.name.localeCompare(b.name));
  return c.json({ tallies });
});

export default r;
