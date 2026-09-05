import {
  BATCH_STATUSES,
  CONTAINER_TYPES,
  COST_CATEGORIES,
  CULTURE_STATUSES,
  CULTURE_TYPES,
  EVENT_TYPES,
  type ForecastProfile,
  INVENTORY_CATEGORIES,
  MEMBERSHIP_ROLES,
  PLANS,
  SOURCE_TYPES,
} from '@hyphaehub/core';
import { createId } from '@paralleldrive/cuid2';
import { relations } from 'drizzle-orm';
import { index, integer, real, sqliteTable, text, unique } from 'drizzle-orm/sqlite-core';

// Re-export better-auth tables so a single schema entry covers every table.
export { account, session, user, verification } from './auth-schema';
import { user } from './auth-schema';

// ── Column helpers ────────────────────────────────────────────────────────────
const pk = () => text('id').primaryKey().$defaultFn(() => createId());
const createdAt = () =>
  integer('created_at', { mode: 'timestamp_ms' }).notNull().$defaultFn(() => new Date());
const updatedAt = () =>
  integer('updated_at', { mode: 'timestamp_ms' })
    .notNull()
    .$defaultFn(() => new Date())
    .$onUpdateFn(() => new Date());
const ts = (name: string) => integer(name, { mode: 'timestamp_ms' });

// ── Workspaces & membership ──────────────────────────────────────────────────
export const workspaces = sqliteTable('workspaces', {
  id: pk(),
  name: text('name').notNull(),
  ownerUserId: text('owner_user_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  plan: text('plan', { enum: PLANS }).notNull().default('FREE'),
  /** Per-org feature-flag overrides ({ [key]: boolean }); missing key inherits platform default. */
  features: text('features', { mode: 'json' }).$type<Record<string, boolean>>(),
  stripeCustomerId: text('stripe_customer_id'),
  stripeSubscriptionId: text('stripe_subscription_id'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/** Singleton (id='platform') holding platform-wide feature defaults set by the super admin. */
export const platformSettings = sqliteTable('platform_settings', {
  id: text('id').primaryKey().default('platform'),
  featureDefaults: text('feature_defaults', { mode: 'json' }).$type<Record<string, boolean>>(),
  updatedAt: updatedAt(),
});

// ── Audit log (who did what, when) ────────────────────────────────────────────
export const auditLogs = sqliteTable(
  'audit_logs',
  {
    id: pk(),
    workspaceId: text('workspace_id').references(() => workspaces.id, { onDelete: 'set null' }),
    userId: text('user_id').references(() => user.id, { onDelete: 'set null' }),
    /** Machine-readable action, e.g. "batch.create", "culture.delete". */
    action: text('action').notNull(),
    entityType: text('entity_type'),
    entityId: text('entity_id'),
    /** HTTP status of the request that produced this entry. */
    status: integer('status'),
    /** Human-readable one-liner. */
    summary: text('summary'),
    metadata: text('metadata', { mode: 'json' }).$type<Record<string, unknown>>(),
    createdAt: createdAt(),
  },
  (t) => [index('audit_ws').on(t.workspaceId, t.createdAt), index('audit_user').on(t.userId)],
);

export const memberships = sqliteTable(
  'memberships',
  {
    id: pk(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    role: text('role', { enum: MEMBERSHIP_ROLES }).notNull().default('MEMBER'),
    createdAt: createdAt(),
  },
  (t) => [unique('memberships_ws_user').on(t.workspaceId, t.userId)],
);

// ── Strains (genetics catalog; workspaceId null = global preset) ──────────────
export const strains = sqliteTable(
  'strains',
  {
    id: pk(),
    workspaceId: text('workspace_id').references(() => workspaces.id, { onDelete: 'cascade' }),
    commonName: text('common_name').notNull(),
    species: text('species'),
    // Free-form so orgs can define custom categories (built-ins in STRAIN_CATEGORIES).
    category: text('category').notNull().default('GOURMET'),
    vendor: text('vendor'),
    optimalTempMinC: real('optimal_temp_min_c'),
    optimalTempMaxC: real('optimal_temp_max_c'),
    isPreset: integer('is_preset', { mode: 'boolean' }).notNull().default(false),
    /** Per-strain cycle-forecast override (durations + learned yields); null inherits defaults. */
    forecastProfile: text('forecast_profile', { mode: 'json' }).$type<ForecastProfile>(),
    notes: text('notes'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('strains_ws').on(t.workspaceId)],
);

// ── Custom strain categories (per org; built-ins live in core STRAIN_CATEGORIES) ─
export const strainCategories = sqliteTable(
  'strain_categories',
  {
    id: pk(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    createdAt: createdAt(),
  },
  (t) => [unique('strain_categories_ws_name').on(t.workspaceId, t.name)],
);

// ── Batches (named run + cost/yield rollup anchor) ───────────────────────────
export const batches = sqliteTable(
  'batches',
  {
    id: pk(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    strainId: text('strain_id').references(() => strains.id, { onDelete: 'set null' }),
    status: text('status', { enum: BATCH_STATUSES }).notNull().default('ACTIVE'),
    goalDryWeightG: real('goal_dry_weight_g'),
    startedAt: ts('started_at'),
    completedAt: ts('completed_at'),
    notes: text('notes'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('batches_ws').on(t.workspaceId), index('batches_status').on(t.status)],
);

// ── Cultures (polymorphic lifecycle unit / lineage node) ─────────────────────
export const cultures = sqliteTable(
  'cultures',
  {
    id: pk(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    batchId: text('batch_id').references(() => batches.id, { onDelete: 'set null' }),
    strainId: text('strain_id').references(() => strains.id, { onDelete: 'set null' }),
    type: text('type', { enum: CULTURE_TYPES }).notNull(),
    label: text('label').notNull(),
    status: text('status', { enum: CULTURE_STATUSES }).notNull().default('PREPPING'),
    sourceType: text('source_type', { enum: SOURCE_TYPES }),
    containerType: text('container_type', { enum: CONTAINER_TYPES }),
    substrateType: text('substrate_type'),
    quantity: real('quantity'),
    quantityUnit: text('quantity_unit'),
    drySubstrateG: real('dry_substrate_g'),
    /** Pending grain cost for a pre-batch jar; attributed to the batch on assign, then cleared. */
    costCents: integer('cost_cents'),
    vendorSource: text('vendor_source'),
    colonizationPct: real('colonization_pct'),
    inoculatedAt: ts('inoculated_at'),
    colonizedAt: ts('colonized_at'),
    fruitingStartedAt: ts('fruiting_started_at'),
    notes: text('notes'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('cultures_ws').on(t.workspaceId),
    index('cultures_batch').on(t.batchId),
    index('cultures_type').on(t.type),
  ],
);

// ── Lineage (parent → child edges; the graph that ties the lifecycle) ────────
export const lineage = sqliteTable(
  'lineage',
  {
    id: pk(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    parentCultureId: text('parent_culture_id')
      .notNull()
      .references(() => cultures.id, { onDelete: 'cascade' }),
    childCultureId: text('child_culture_id')
      .notNull()
      .references(() => cultures.id, { onDelete: 'cascade' }),
    note: text('note'),
    createdAt: createdAt(),
  },
  (t) => [
    unique('lineage_edge').on(t.parentCultureId, t.childCultureId),
    index('lineage_parent').on(t.parentCultureId),
    index('lineage_child').on(t.childCultureId),
  ],
);

// ── Events / observations (timeline) ─────────────────────────────────────────
export const events = sqliteTable(
  'events',
  {
    id: pk(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    cultureId: text('culture_id')
      .notNull()
      .references(() => cultures.id, { onDelete: 'cascade' }),
    batchId: text('batch_id').references(() => batches.id, { onDelete: 'set null' }),
    type: text('type', { enum: EVENT_TYPES }).notNull(),
    occurredAt: ts('occurred_at').notNull().$defaultFn(() => new Date()),
    note: text('note'),
    data: text('data', { mode: 'json' }).$type<Record<string, unknown>>(),
    createdAt: createdAt(),
  },
  (t) => [index('events_culture').on(t.cultureId), index('events_ws').on(t.workspaceId)],
);

// ── Harvests / flushes ───────────────────────────────────────────────────────
export const harvests = sqliteTable(
  'harvests',
  {
    id: pk(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    cultureId: text('culture_id')
      .notNull()
      .references(() => cultures.id, { onDelete: 'cascade' }),
    batchId: text('batch_id').references(() => batches.id, { onDelete: 'set null' }),
    flushNumber: integer('flush_number').notNull().default(1),
    wetWeightG: real('wet_weight_g').notNull(),
    dryWeightG: real('dry_weight_g'),
    harvestedAt: ts('harvested_at').$defaultFn(() => new Date()),
    driedAt: ts('dried_at'),
    notes: text('notes'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('harvests_culture').on(t.cultureId), index('harvests_batch').on(t.batchId)],
);

// ── Photos (R2 key in cloud, local path in self-host) ────────────────────────
export const photos = sqliteTable(
  'photos',
  {
    id: pk(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    cultureId: text('culture_id').references(() => cultures.id, { onDelete: 'cascade' }),
    eventId: text('event_id').references(() => events.id, { onDelete: 'cascade' }),
    harvestId: text('harvest_id').references(() => harvests.id, { onDelete: 'cascade' }),
    key: text('key').notNull(),
    caption: text('caption'),
    contentType: text('content_type'),
    sizeBytes: integer('size_bytes'),
    createdAt: createdAt(),
  },
  (t) => [index('photos_ws').on(t.workspaceId), index('photos_culture').on(t.cultureId)],
);

// ── Inventory (consumables catalog) ──────────────────────────────────────────
export const inventoryItems = sqliteTable(
  'inventory_items',
  {
    id: pk(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    category: text('category', { enum: INVENTORY_CATEGORIES }).notNull().default('OTHER'),
    unit: text('unit').notNull().default('unit'),
    unitCostCents: integer('unit_cost_cents').notNull().default(0),
    quantityOnHand: real('quantity_on_hand').notNull().default(0),
    supplier: text('supplier'),
    notes: text('notes'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('inventory_ws').on(t.workspaceId)],
);

// ── Cost entries (line items; the cost-per-batch backbone) ───────────────────
export const costEntries = sqliteTable(
  'cost_entries',
  {
    id: pk(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    batchId: text('batch_id').references(() => batches.id, { onDelete: 'cascade' }),
    cultureId: text('culture_id').references(() => cultures.id, { onDelete: 'set null' }),
    inventoryItemId: text('inventory_item_id').references(() => inventoryItems.id, {
      onDelete: 'set null',
    }),
    description: text('description').notNull(),
    category: text('category', { enum: COST_CATEGORIES }).notNull().default('MATERIALS'),
    amountCents: integer('amount_cents').notNull(),
    quantity: real('quantity'),
    occurredAt: ts('occurred_at').$defaultFn(() => new Date()),
    createdAt: createdAt(),
  },
  (t) => [index('costs_ws').on(t.workspaceId), index('costs_batch').on(t.batchId)],
);

// ── Relations (for convenience queries) ──────────────────────────────────────
export const workspacesRelations = relations(workspaces, ({ many }) => ({
  batches: many(batches),
  cultures: many(cultures),
  strains: many(strains),
  memberships: many(memberships),
}));

export const batchesRelations = relations(batches, ({ one, many }) => ({
  workspace: one(workspaces, { fields: [batches.workspaceId], references: [workspaces.id] }),
  strain: one(strains, { fields: [batches.strainId], references: [strains.id] }),
  cultures: many(cultures),
  harvests: many(harvests),
  costEntries: many(costEntries),
}));

export const culturesRelations = relations(cultures, ({ one, many }) => ({
  workspace: one(workspaces, { fields: [cultures.workspaceId], references: [workspaces.id] }),
  batch: one(batches, { fields: [cultures.batchId], references: [batches.id] }),
  strain: one(strains, { fields: [cultures.strainId], references: [strains.id] }),
  events: many(events),
  harvests: many(harvests),
}));

export const lineageRelations = relations(lineage, ({ one }) => ({
  parent: one(cultures, {
    fields: [lineage.parentCultureId],
    references: [cultures.id],
    relationName: 'parent',
  }),
  child: one(cultures, {
    fields: [lineage.childCultureId],
    references: [cultures.id],
    relationName: 'child',
  }),
}));

export const eventsRelations = relations(events, ({ one }) => ({
  culture: one(cultures, { fields: [events.cultureId], references: [cultures.id] }),
}));

export const harvestsRelations = relations(harvests, ({ one }) => ({
  culture: one(cultures, { fields: [harvests.cultureId], references: [cultures.id] }),
  batch: one(batches, { fields: [harvests.batchId], references: [batches.id] }),
}));

export const costEntriesRelations = relations(costEntries, ({ one }) => ({
  batch: one(batches, { fields: [costEntries.batchId], references: [batches.id] }),
}));
