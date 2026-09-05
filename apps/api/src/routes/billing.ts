import { type Plan, PLANS } from '@hyphaehub/core';
import { workspaces } from '@hyphaehub/db';
import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';
import {
  createCheckoutSession,
  createPortalSession,
  stripeConfig,
  verifyStripeSignature,
} from '../lib/stripe';
import { requireAuth, requireOrgRole } from '../middleware/auth';
import type { AppEnv } from '../types';

const r = new Hono<AppEnv>();

// ── Stripe webhook (public; verified by signature) ───────────────────────────
r.post('/webhook', async (c) => {
  const cfg = stripeConfig(c.env);
  if (!cfg?.webhookSecret) return c.json({ error: 'Billing is not configured.' }, 501);
  const payload = await c.req.text();
  const ok = await verifyStripeSignature(payload, c.req.header('stripe-signature') ?? null, cfg.webhookSecret);
  if (!ok) return c.json({ error: 'Invalid signature.' }, 400);

  const event = JSON.parse(payload) as { type: string; data: { object: Record<string, any> } };
  const db = c.var.db;
  const obj = event.data.object;

  if (event.type === 'checkout.session.completed') {
    const wsId = (obj.metadata?.workspaceId as string) ?? (obj.client_reference_id as string);
    const plan = obj.metadata?.plan as string | undefined;
    if (wsId && plan && (PLANS as readonly string[]).includes(plan)) {
      await db
        .update(workspaces)
        .set({
          plan: plan as Plan,
          stripeCustomerId: (obj.customer as string) ?? null,
          stripeSubscriptionId: (obj.subscription as string) ?? null,
        })
        .where(eq(workspaces.id, wsId));
    }
  } else if (event.type === 'customer.subscription.deleted') {
    const wsId = obj.metadata?.workspaceId as string | undefined;
    if (wsId) await db.update(workspaces).set({ plan: 'FREE' }).where(eq(workspaces.id, wsId));
    else await db.update(workspaces).set({ plan: 'FREE' }).where(eq(workspaces.stripeSubscriptionId, obj.id as string));
  } else if (event.type === 'customer.subscription.updated') {
    const status = obj.status as string | undefined;
    const wsId = obj.metadata?.workspaceId as string | undefined;
    if (wsId && status && !['active', 'trialing', 'past_due'].includes(status)) {
      await db.update(workspaces).set({ plan: 'FREE' }).where(eq(workspaces.id, wsId));
    }
  }
  return c.json({ received: true });
});

// ── Start a checkout for a plan upgrade (org owner) ──────────────────────────
r.post(
  '/checkout',
  requireAuth,
  requireOrgRole('OWNER'),
  async (c) => {
    const cfg = stripeConfig(c.env);
    if (!cfg) return c.json({ error: 'Billing is not configured on this instance.' }, 501);
    const body = await c.req.json().catch(() => ({}));
    const parsed = z.object({ plan: z.enum(['PRO', 'FARM']) }).safeParse(body);
    if (!parsed.success) throw new HTTPException(400, { message: 'Choose a PRO or FARM plan.' });
    const plan = parsed.data.plan as Plan;
    const priceId = cfg.prices[plan];
    if (!priceId) return c.json({ error: `No Stripe price configured for ${plan}.` }, 501);

    const ws = c.var.workspace;
    const appUrl = c.env.APP_URL ?? '';
    const { url } = await createCheckoutSession(cfg, {
      priceId,
      workspaceId: ws.id,
      plan,
      customerEmail: c.var.user.email,
      customerId: ws.stripeCustomerId ?? undefined,
      successUrl: `${appUrl}/settings?billing=success`,
      cancelUrl: `${appUrl}/settings?billing=cancelled`,
    });
    return c.json({ url });
  },
);

// ── Open the Stripe billing portal (org owner) ───────────────────────────────
r.post(
  '/portal',
  requireAuth,
  requireOrgRole('OWNER'),
  async (c) => {
    const cfg = stripeConfig(c.env);
    if (!cfg) return c.json({ error: 'Billing is not configured on this instance.' }, 501);
    const ws = c.var.workspace;
    if (!ws.stripeCustomerId) return c.json({ error: 'No active subscription to manage.' }, 400);
    const { url } = await createPortalSession(cfg, {
      customerId: ws.stripeCustomerId,
      returnUrl: `${c.env.APP_URL ?? ''}/settings`,
    });
    return c.json({ url });
  },
);

export default r;
