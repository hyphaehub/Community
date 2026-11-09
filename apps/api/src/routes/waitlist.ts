import { zValidator } from '@hono/zod-validator';
import { waitlistSignupSchema } from '@hyphaehub/core';
import { waitlistSignups } from '@hyphaehub/db';
import { Hono } from 'hono';
import { sendEmail, waitlistConfirmEmail } from '../lib/email';
import type { AppEnv } from '../types';

const r = new Hono<AppEnv>();

/**
 * Public early-access signup. No auth. Idempotent on email (unique index +
 * onConflictDoNothing), honeypot-guarded, and sends a confirmation only on a
 * genuinely new signup (graceful no-op until Resend is configured).
 */
r.post('/', zValidator('json', waitlistSignupSchema), async (c) => {
  const d = c.req.valid('json');
  if (d.hp) return c.json({ ok: true }); // honeypot filled → a bot; drop silently
  const email = d.email.trim().toLowerCase();
  const inserted = await c.var.db
    .insert(waitlistSignups)
    .values({
      email,
      name: d.name?.trim() || null,
      source: d.source ?? null,
      referrer: (c.req.header('referer') ?? '').slice(0, 512) || null,
    })
    .onConflictDoNothing()
    .returning({ id: waitlistSignups.id });
  if (inserted[0]) {
    try {
      await sendEmail(c.env, { to: email, ...waitlistConfirmEmail() });
    } catch {
      // never fail the signup on a mail hiccup
    }
  }
  return c.json({ ok: true }, 201);
});

export default r;
