import { zValidator } from '@hono/zod-validator';
import { dibCreateSchema, portalSessionSchema, voteCreateSchema } from '@hyphaehub/core';
import {
  batches,
  buyerTokens,
  buyers,
  cultures,
  dibs,
  listings,
  strainVotes,
  strains,
  workspaces,
} from '@hyphaehub/db';
import { and, desc, eq, inArray, or } from 'drizzle-orm';
import { type Context, Hono } from 'hono';
import { chunk } from '../lib/batch';
import { getFeaturesForWorkspace } from '../lib/features';
import { workspaceForecasts } from '../lib/forecast';
import {
  SESSION_TOKEN_TTL_MS,
  findLiveToken,
  generateToken,
  requireBuyer,
  sha256hex,
} from '../lib/portal';
import { requireFeature } from '../middleware/auth';
import type { AppEnv } from '../types';

const r = new Hono<AppEnv>();

// ── Login: exchange a magic-link token for a session (no buyer auth yet) ──────
r.post('/session', zValidator('json', portalSessionSchema), async (c) => {
  const { token } = c.req.valid('json');
  const login = await findLiveToken(c.var.db, token, 'LOGIN');
  if (!login) {
    return c.json({ error: 'This link is invalid or expired. Ask the farm for a new one.' }, 401);
  }
  // Atomically claim the single-use link: a lost race deletes 0 rows → reject, so
  // one magic link can never mint two sessions.
  const claimed = await c.var.db
    .delete(buyerTokens)
    .where(eq(buyerTokens.id, login.id))
    .returning({ id: buyerTokens.id });
  if (!claimed[0]) {
    return c.json({ error: 'This link was already used. Ask the farm for a new one.' }, 401);
  }

  const [buyer] = await c.var.db.select().from(buyers).where(eq(buyers.id, login.buyerId)).limit(1);
  const [ws] = await c.var.db
    .select()
    .from(workspaces)
    .where(eq(workspaces.id, login.workspaceId))
    .limit(1);
  if (!buyer || !ws) return c.json({ error: 'Account not found' }, 404);
  // Enforce the same gates as requireBuyer at sign-in time.
  if (buyer.status === 'DISABLED') return c.json({ error: 'Access has been disabled.' }, 403);
  if (!ws.storefrontEnabled || ws.plan !== 'FARM')
    return c.json({ error: 'This storefront is not open.' }, 403);

  const session = generateToken();
  await c.var.db.insert(buyerTokens).values({
    buyerId: login.buyerId,
    workspaceId: login.workspaceId,
    tokenHash: await sha256hex(session),
    purpose: 'SESSION',
    expiresAt: new Date(Date.now() + SESSION_TOKEN_TTL_MS),
  });
  await c.var.db
    .update(buyers)
    .set({ status: 'ACTIVE', lastSeenAt: new Date() })
    .where(eq(buyers.id, login.buyerId));

  return c.json({
    sessionToken: session,
    buyer: { id: buyer.id, email: buyer.email, name: buyer.name },
    farm: { name: ws.name, blurb: ws.storefrontBlurb },
  });
});

// Everything below requires a valid buyer session.
r.use('*', requireBuyer);

r.get('/me', async (c) => {
  const ws = c.var.workspace;
  const features = await getFeaturesForWorkspace(c.var.db, ws);
  return c.json({
    buyer: c.var.buyer,
    farm: {
      name: ws.name,
      blurb: ws.storefrontBlurb,
      showForecast: ws.storefrontShowForecast,
      voting: features.strainVoting,
    },
  });
});

/** Sum of not-yet-declined dib quantities per listing (soft reservation math). */
async function reservedByListing(dbWsId: string, c: { var: AppEnv['Variables'] }) {
  const rows = await c.var.db
    .select({ listingId: dibs.listingId, qty: dibs.requestedQtyG, status: dibs.status })
    .from(dibs)
    .where(eq(dibs.workspaceId, dbWsId));
  const map = new Map<string, number>();
  for (const d of rows) {
    if (!d.listingId) continue;
    if (d.status === 'DECLINED' || d.status === 'CANCELLED') continue;
    map.set(d.listingId, (map.get(d.listingId) ?? 0) + (d.qty ?? 0));
  }
  return map;
}

// ── Storefront: available listings + (optional) predicted upcoming harvests ───
r.get('/storefront', async (c) => {
  const ws = c.var.workspace;
  const listingRows = await c.var.db
    .select()
    .from(listings)
    .where(and(eq(listings.workspaceId, ws.id), eq(listings.status, 'AVAILABLE')))
    .orderBy(desc(listings.createdAt));
  const reserved = await reservedByListing(ws.id, c);
  const available = listingRows.map((l) => ({
    ...l,
    reservedG: reserved.get(l.id) ?? 0,
    remainingG: Math.max(0, l.quantityG - (reserved.get(l.id) ?? 0)),
  }));

  let predicted: {
    batchId: string;
    label: string;
    stage: string;
    predictedAt: string | null;
    expectedYieldG: number | null;
  }[] = [];
  if (ws.storefrontShowForecast) {
    const now = new Date();
    const horizonMs = (ws.storefrontForecastDays ?? 21) * 24 * 60 * 60 * 1000;
    const cutoff = now.getTime() + horizonMs;
    const forecasts = await workspaceForecasts(c.var.db, ws.id, now);
    const strainRows = await c.var.db
      .select({ id: strains.id, name: strains.commonName })
      .from(strains)
      .where(eq(strains.workspaceId, ws.id));
    const strainName = new Map(strainRows.map((s) => [s.id, s.name]));
    for (const f of forecasts) {
      if (f.ended) continue;
      for (const m of f.timeline) {
        if (m.expectedYieldG == null || m.actualAt || !m.predictedAt) continue;
        const t = new Date(m.predictedAt).getTime();
        if (t < now.getTime() || t > cutoff) continue;
        predicted.push({
          batchId: f.batchId ?? '',
          label: (f.strainId && strainName.get(f.strainId)) || f.batchName || 'Upcoming harvest',
          stage: m.label,
          predictedAt: m.predictedAt,
          expectedYieldG: m.expectedYieldG,
        });
      }
    }
    predicted = predicted
      .sort((a, b) => (a.predictedAt ?? '').localeCompare(b.predictedAt ?? ''))
      .slice(0, 40);
  }

  return c.json({ available, predicted, showForecast: ws.storefrontShowForecast });
});

// ── This buyer's dibs ─────────────────────────────────────────────────────────
r.get('/dibs', async (c) => {
  const buyer = c.var.buyer;
  const rows = await c.var.db
    .select()
    .from(dibs)
    .where(eq(dibs.buyerId, buyer.id))
    .orderBy(desc(dibs.createdAt));
  const listingIds = [...new Set(rows.map((d) => d.listingId).filter((x): x is string => !!x))];
  const listingRows = listingIds.length
    ? await c.var.db.select().from(listings).where(inArray(listings.id, listingIds))
    : [];
  const byId = new Map(listingRows.map((l) => [l.id, l]));
  return c.json(
    rows.map((d) => ({ ...d, listing: d.listingId ? (byId.get(d.listingId) ?? null) : null })),
  );
});

r.post('/dibs', zValidator('json', dibCreateSchema), async (c) => {
  const ws = c.var.workspace;
  const buyer = c.var.buyer;
  const d = c.req.valid('json');

  // Validate the referenced listing/batch belongs to this farm and is offered.
  if (d.listingId) {
    const [l] = await c.var.db
      .select()
      .from(listings)
      .where(and(eq(listings.id, d.listingId), eq(listings.workspaceId, ws.id)))
      .limit(1);
    if (!l) return c.json({ error: 'Listing not found' }, 404);
    if (l.status !== 'AVAILABLE')
      return c.json({ error: 'That listing is no longer available' }, 409);
  }
  if (d.batchId) {
    // Only allow pre-orders against the farm's own, still-running batches, and
    // only when the farm actually exposes its forecast.
    if (!ws.storefrontShowForecast) {
      return c.json({ error: 'Pre-orders are not open for this farm.' }, 409);
    }
    const [b] = await c.var.db
      .select({ id: batches.id, status: batches.status })
      .from(batches)
      .where(and(eq(batches.id, d.batchId), eq(batches.workspaceId, ws.id)))
      .limit(1);
    if (!b) return c.json({ error: 'Batch not found' }, 404);
    if (b.status !== 'ACTIVE') return c.json({ error: 'That batch is no longer upcoming' }, 409);
  }

  const rows = await c.var.db
    .insert(dibs)
    .values({
      workspaceId: ws.id,
      buyerId: buyer.id,
      listingId: d.listingId ?? null,
      batchId: d.batchId ?? null,
      requestedQtyG: d.requestedQtyG ?? null,
      note: d.note ?? null,
      status: 'PENDING',
    })
    .returning();
  return c.json(rows[0], 201);
});

/** A buyer may cancel their own dib while it's still pending/approved. */
r.post('/dibs/:id/cancel', async (c) => {
  const buyer = c.var.buyer;
  const rows = await c.var.db
    .update(dibs)
    .set({ status: 'CANCELLED' })
    .where(
      and(
        eq(dibs.id, c.req.param('id')),
        eq(dibs.buyerId, buyer.id),
        inArray(dibs.status, ['PENDING', 'APPROVED']),
      ),
    )
    .returning();
  if (!rows[0]) return c.json({ error: 'Not found' }, 404);
  return c.json(rows[0]);
});

// ── Strain voting: candidate strains come from the farm's library stock ───────
/** The strains the farm holds in its library (distinct strainIds on STORED cultures). */
async function libraryStrainIds(c: Context<AppEnv>, wsId: string): Promise<string[]> {
  const rows = await c.var.db
    .select({ strainId: cultures.strainId })
    .from(cultures)
    .where(and(eq(cultures.workspaceId, wsId), eq(cultures.status, 'STORED')));
  return [...new Set(rows.map((x) => x.strainId).filter((x): x is string => !!x))];
}

/** Candidate strains to vote on, with live tallies and whether this buyer voted. */
r.get('/votes', requireFeature('strainVoting'), async (c) => {
  const ws = c.var.workspace;
  const buyer = c.var.buyer;
  const strainIds = await libraryStrainIds(c, ws.id);
  if (strainIds.length === 0) return c.json({ candidates: [] });

  const info = new Map<string, { name: string; species: string | null; category: string }>();
  for (const group of chunk(strainIds, 90)) {
    if (!group.length) continue;
    const srows = await c.var.db
      .select({
        id: strains.id,
        name: strains.commonName,
        species: strains.species,
        category: strains.category,
      })
      .from(strains)
      .where(
        and(
          inArray(strains.id, group),
          or(eq(strains.workspaceId, ws.id), eq(strains.isPreset, true)),
        ),
      );
    for (const s of srows)
      info.set(s.id, { name: s.name, species: s.species, category: s.category });
  }

  const voteRows = await c.var.db
    .select({ strainId: strainVotes.strainId, buyerId: strainVotes.buyerId })
    .from(strainVotes)
    .where(eq(strainVotes.workspaceId, ws.id));
  const tally = new Map<string, number>();
  const mine = new Set<string>();
  for (const v of voteRows) {
    tally.set(v.strainId, (tally.get(v.strainId) ?? 0) + 1);
    if (v.buyerId === buyer.id) mine.add(v.strainId);
  }

  const candidates = strainIds
    .filter((id) => info.has(id))
    .map((id) => {
      const s = info.get(id) as { name: string; species: string | null; category: string };
      return {
        strainId: id,
        name: s.name,
        species: s.species,
        category: s.category,
        votes: tally.get(id) ?? 0,
        voted: mine.has(id),
      };
    })
    .sort((a, b) => b.votes - a.votes || a.name.localeCompare(b.name));
  return c.json({ candidates });
});

/** Cast a vote (idempotent — one vote per buyer per strain). */
r.post(
  '/votes',
  requireFeature('strainVoting'),
  zValidator('json', voteCreateSchema),
  async (c) => {
    const ws = c.var.workspace;
    const buyer = c.var.buyer;
    const { strainId } = c.req.valid('json');
    // Only strains the farm actually has in its library are votable.
    const [stock] = await c.var.db
      .select({ id: cultures.id })
      .from(cultures)
      .where(
        and(
          eq(cultures.workspaceId, ws.id),
          eq(cultures.strainId, strainId),
          eq(cultures.status, 'STORED'),
        ),
      )
      .limit(1);
    if (!stock) return c.json({ error: 'That strain is not available to vote on.' }, 404);
    await c.var.db
      .insert(strainVotes)
      .values({ workspaceId: ws.id, buyerId: buyer.id, strainId })
      .onConflictDoNothing();
    return c.json({ ok: true }, 201);
  },
);

/** Retract this buyer's vote for a strain. */
r.delete('/votes/:strainId', requireFeature('strainVoting'), async (c) => {
  const ws = c.var.workspace;
  const buyer = c.var.buyer;
  await c.var.db
    .delete(strainVotes)
    .where(
      and(
        eq(strainVotes.workspaceId, ws.id),
        eq(strainVotes.buyerId, buyer.id),
        eq(strainVotes.strainId, c.req.param('strainId')),
      ),
    );
  return c.json({ ok: true });
});

export default r;
