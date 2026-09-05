import type { BaseSQLiteDatabase } from 'drizzle-orm/sqlite-core';
import * as schema from './schema';

export * from './schema';
export { createD1Db } from './client-d1';

/**
 * Driver-agnostic database type. Both the D1 (Worker) and libSQL (Node) clients
 * satisfy this, so route/service code can accept either without caring which.
 */
export type HyphaeDB = BaseSQLiteDatabase<'async', any, typeof schema>;

// Convenience row types
export type Workspace = typeof schema.workspaces.$inferSelect;
export type NewWorkspace = typeof schema.workspaces.$inferInsert;
export type Membership = typeof schema.memberships.$inferSelect;
export type Strain = typeof schema.strains.$inferSelect;
export type NewStrain = typeof schema.strains.$inferInsert;
export type Batch = typeof schema.batches.$inferSelect;
export type NewBatch = typeof schema.batches.$inferInsert;
export type Culture = typeof schema.cultures.$inferSelect;
export type NewCulture = typeof schema.cultures.$inferInsert;
export type Lineage = typeof schema.lineage.$inferSelect;
export type Event = typeof schema.events.$inferSelect;
export type NewEvent = typeof schema.events.$inferInsert;
export type Harvest = typeof schema.harvests.$inferSelect;
export type NewHarvest = typeof schema.harvests.$inferInsert;
export type Photo = typeof schema.photos.$inferSelect;
export type InventoryItem = typeof schema.inventoryItems.$inferSelect;
export type NewInventoryItem = typeof schema.inventoryItems.$inferInsert;
export type CostEntry = typeof schema.costEntries.$inferSelect;
export type NewCostEntry = typeof schema.costEntries.$inferInsert;
