import type { D1Database } from '@cloudflare/workers-types';
import { drizzle } from 'drizzle-orm/d1';
import * as schema from './schema';

/** Create a Drizzle client backed by a Cloudflare D1 binding (cloud + wrangler dev). */
export function createD1Db(d1: D1Database) {
  return drizzle(d1, { schema });
}
