import { type Config, createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import * as schema from './schema';

/**
 * Create a Drizzle client backed by libSQL / local SQLite (self-hosted Node).
 * Pass e.g. `{ url: 'file:./data/hyphaehub.db' }` or a Turso URL + authToken.
 */
export function createLibsqlDb(config: Config) {
  const client = createClient(config);
  return drizzle(client, { schema });
}

export type LibsqlDb = ReturnType<typeof createLibsqlDb>;
