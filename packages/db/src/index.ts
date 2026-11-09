import type { BatchItem, BatchResponse } from 'drizzle-orm/batch';
import type { BaseSQLiteDatabase } from 'drizzle-orm/sqlite-core';
import type * as schema from './schema';

export * from './schema';
export { createD1Db } from './client-d1';
/** Generate a new primary-key id (cuid2) — matches the `$defaultFn` on every
 *  table's `id`. Use it to pre-generate ids so related rows can reference each
 *  other inside a single atomic {@link HyphaeDB.batch}. */
export { createId as newId } from '@paralleldrive/cuid2';

/**
 * Driver-agnostic database type. Both the D1 (Worker) and libSQL (Node) clients
 * satisfy this, so route/service code can accept either without caring which.
 *
 * `batch` is declared here (with the exact signature both drivers implement) so
 * route code can run multiple statements in a single atomic transaction — the
 * only way to get atomicity on D1, which has no interactive `transaction()`.
 */
export type HyphaeDB = BaseSQLiteDatabase<'async', any, typeof schema> & {
  batch<U extends BatchItem<'sqlite'>, T extends Readonly<[U, ...U[]]>>(
    batch: T,
  ): Promise<BatchResponse<T>>;
};

/** A statement that can go into {@link HyphaeDB.batch}. */
export type HyphaeBatchItem = BatchItem<'sqlite'>;

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
export type LogEntry = typeof schema.logEntries.$inferSelect;
export type NewLogEntry = typeof schema.logEntries.$inferInsert;
export type EnvironmentReading = typeof schema.environmentReadings.$inferSelect;
export type NewEnvironmentReading = typeof schema.environmentReadings.$inferInsert;
export type Buyer = typeof schema.buyers.$inferSelect;
export type NewBuyer = typeof schema.buyers.$inferInsert;
export type BuyerToken = typeof schema.buyerTokens.$inferSelect;
export type Listing = typeof schema.listings.$inferSelect;
export type NewListing = typeof schema.listings.$inferInsert;
export type Dib = typeof schema.dibs.$inferSelect;
export type NewDib = typeof schema.dibs.$inferInsert;
export type StrainVote = typeof schema.strainVotes.$inferSelect;
export type NewStrainVote = typeof schema.strainVotes.$inferInsert;
export type WaitlistSignup = typeof schema.waitlistSignups.$inferSelect;
export type NewWaitlistSignup = typeof schema.waitlistSignups.$inferInsert;
export type Photo = typeof schema.photos.$inferSelect;
export type InventoryItem = typeof schema.inventoryItems.$inferSelect;
export type NewInventoryItem = typeof schema.inventoryItems.$inferInsert;
export type InventoryAdjustment = typeof schema.inventoryAdjustments.$inferSelect;
export type NewInventoryAdjustment = typeof schema.inventoryAdjustments.$inferInsert;
export type CostEntry = typeof schema.costEntries.$inferSelect;
export type NewCostEntry = typeof schema.costEntries.$inferInsert;
