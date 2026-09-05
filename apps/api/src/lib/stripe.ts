import type { Plan } from '@hyphaehub/core';
import type { Env } from '../types';

export interface StripeConfig {
  secretKey: string;
  webhookSecret?: string;
  prices: Partial<Record<Plan, string>>;
}

/** Resolve Stripe config from env, or null when billing isn't configured. */
export function stripeConfig(env: Env): StripeConfig | null {
  if (!env.HYPHAE_STRIPE_SECRET_KEY) return null;
  return {
    secretKey: env.HYPHAE_STRIPE_SECRET_KEY,
    webhookSecret: env.HYPHAE_STRIPE_WEBHOOK_SECRET,
    prices: {
      PRO: env.HYPHAE_STRIPE_PRICE_PRO,
      FARM: env.HYPHAE_STRIPE_PRICE_FARM,
    },
  };
}

/** Flatten a nested object into Stripe's form-encoded params (a[b][c]=v). */
function encodeForm(obj: Record<string, unknown>, prefix = ''): string {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (typeof v === 'object') parts.push(encodeForm(v as Record<string, unknown>, key));
    else parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(v))}`);
  }
  return parts.filter(Boolean).join('&');
}

async function stripePost(secretKey: string, path: string, body: Record<string, unknown>) {
  const res = await fetch(`https://api.stripe.com/v1${path}`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${secretKey}`,
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: encodeForm(body),
  });
  const data = (await res.json()) as Record<string, unknown>;
  if (!res.ok) {
    const err = (data.error as { message?: string } | undefined)?.message ?? 'Stripe request failed';
    throw new Error(err);
  }
  return data;
}

export async function createCheckoutSession(
  cfg: StripeConfig,
  opts: {
    priceId: string;
    workspaceId: string;
    plan: Plan;
    customerEmail?: string;
    customerId?: string;
    successUrl: string;
    cancelUrl: string;
  },
): Promise<{ url: string }> {
  const body: Record<string, unknown> = {
    mode: 'subscription',
    'line_items[0][price]': opts.priceId,
    'line_items[0][quantity]': 1,
    success_url: opts.successUrl,
    cancel_url: opts.cancelUrl,
    client_reference_id: opts.workspaceId,
    'metadata[workspaceId]': opts.workspaceId,
    'metadata[plan]': opts.plan,
    'subscription_data[metadata][workspaceId]': opts.workspaceId,
    'subscription_data[metadata][plan]': opts.plan,
  };
  if (opts.customerId) body.customer = opts.customerId;
  else if (opts.customerEmail) body.customer_email = opts.customerEmail;
  const session = (await stripePost(cfg.secretKey, '/checkout/sessions', body)) as { url: string };
  return { url: session.url };
}

export async function createPortalSession(
  cfg: StripeConfig,
  opts: { customerId: string; returnUrl: string },
): Promise<{ url: string }> {
  const session = (await stripePost(cfg.secretKey, '/billing_portal/sessions', {
    customer: opts.customerId,
    return_url: opts.returnUrl,
  })) as { url: string };
  return { url: session.url };
}

/**
 * Verify a Stripe webhook signature (scheme v1 = HMAC-SHA256 of `${t}.${payload}`)
 * using Web Crypto, so it works on Cloudflare Workers without the Stripe SDK.
 */
export async function verifyStripeSignature(
  payload: string,
  sigHeader: string | null,
  secret: string,
  toleranceSec = 300,
): Promise<boolean> {
  if (!sigHeader) return false;
  const parts = Object.fromEntries(
    sigHeader.split(',').map((kv) => {
      const [k, v] = kv.split('=');
      return [k?.trim(), v?.trim()];
    }),
  ) as { t?: string; v1?: string };
  if (!parts.t || !parts.v1) return false;

  // Reject stale timestamps when a clock is available (best-effort).
  const now = Math.floor(Date.now() / 1000);
  if (Number.isFinite(now) && Math.abs(now - Number(parts.t)) > toleranceSec) return false;

  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const mac = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(`${parts.t}.${payload}`),
  );
  const expected = [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, '0')).join('');
  return timingSafeEqual(expected, parts.v1);
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
