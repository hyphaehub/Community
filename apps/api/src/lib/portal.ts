import { type HyphaeDB, buyerTokens, buyers, workspaces } from '@hyphaehub/db';
import { and, eq } from 'drizzle-orm';
import { createMiddleware } from 'hono/factory';
import type { AppEnv } from '../types';

/** A high-entropy opaque token (32 random bytes, hex). */
export function generateToken(): string {
  const b = crypto.getRandomValues(new Uint8Array(32));
  return [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
}

/** SHA-256 hex of a token — only the hash is ever stored. */
export async function sha256hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return [...new Uint8Array(digest)].map((x) => x.toString(16).padStart(2, '0')).join('');
}

export const LOGIN_TOKEN_TTL_MS = 30 * 60 * 1000; // 30 min magic-link
export const SESSION_TOKEN_TTL_MS = 45 * 24 * 60 * 60 * 1000; // 45 days

/** Look up a live (unexpired) buyer token by its plaintext value + purpose. */
export async function findLiveToken(db: HyphaeDB, token: string, purpose: 'LOGIN' | 'SESSION') {
  const hash = await sha256hex(token);
  const rows = await db
    .select()
    .from(buyerTokens)
    .where(and(eq(buyerTokens.tokenHash, hash), eq(buyerTokens.purpose, purpose)))
    .limit(1);
  const tok = rows[0];
  if (!tok || tok.expiresAt.getTime() < Date.now()) return null;
  return tok;
}

/**
 * Authenticate a buyer (purchaser) via a `Bearer <session token>` header. On
 * success sets `c.var.buyer` and `c.var.workspace` (the farm) for the request.
 */
export const requireBuyer = createMiddleware<AppEnv>(async (c, next) => {
  const header = c.req.header('authorization') ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (!token) return c.json({ error: 'Unauthorized' }, 401);

  const tok = await findLiveToken(c.var.db, token, 'SESSION');
  if (!tok) return c.json({ error: 'Session expired' }, 401);

  const buyerRows = await c.var.db.select().from(buyers).where(eq(buyers.id, tok.buyerId)).limit(1);
  const buyer = buyerRows[0];
  if (!buyer || buyer.status === 'DISABLED') return c.json({ error: 'Unauthorized' }, 401);

  const wsRows = await c.var.db
    .select()
    .from(workspaces)
    .where(eq(workspaces.id, buyer.workspaceId))
    .limit(1);
  const ws = wsRows[0];
  // The storefront is a FARM-tier feature on BOTH sides: if the farm isn't on FARM
  // (e.g. after a downgrade) stop serving buyers too, even on a still-live session.
  if (!ws || !ws.storefrontEnabled || ws.plan !== 'FARM')
    return c.json({ error: 'Storefront unavailable' }, 403);

  c.set('buyer', { id: buyer.id, workspaceId: buyer.workspaceId, email: buyer.email });
  c.set('workspace', ws);
  await next();
});
