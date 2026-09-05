import { defineConfig } from 'tsup';

export default defineConfig({
  // Three entry points so the Worker never bundles the Node-only libSQL client.
  entry: ['src/index.ts', 'src/node.ts', 'src/schema.ts'],
  format: ['esm'],
  dts: true,
  clean: true,
  sourcemap: true,
  // Keep drivers + heavy deps external; consumers provide the right one.
  external: [
    'drizzle-orm',
    'drizzle-orm/*',
    '@libsql/client',
    '@cloudflare/workers-types',
    '@hyphaehub/core',
    '@paralleldrive/cuid2',
  ],
});
