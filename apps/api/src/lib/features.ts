import { type FeatureFlags, resolveFeatures } from '@hyphaehub/core';
import { type HyphaeDB, platformSettings, type Workspace } from '@hyphaehub/db';
import { eq } from 'drizzle-orm';

/** Platform-wide feature defaults (super-admin set), or {} if unset. */
export async function getPlatformDefaults(db: HyphaeDB): Promise<Record<string, boolean>> {
  const [row] = await db
    .select()
    .from(platformSettings)
    .where(eq(platformSettings.id, 'platform'))
    .limit(1);
  return (row?.featureDefaults as Record<string, boolean> | null) ?? {};
}

/** Effective feature flags for a workspace: org override → platform default → built-in. */
export async function getFeaturesForWorkspace(
  db: HyphaeDB,
  ws: Workspace,
): Promise<FeatureFlags> {
  const defaults = await getPlatformDefaults(db);
  return resolveFeatures(ws.features ?? null, defaults);
}
