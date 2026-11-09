import {
  BATCH_STATUSES,
  BUYER_STATUSES,
  CONTAINER_TYPES,
  CONTAMINANT_TYPES,
  CONTAMINATION_CAUSES,
  COST_CATEGORIES,
  CULTURE_STATUSES,
  CULTURE_TYPES,
  DIB_STATUSES,
  EVENT_TYPES,
  type ForecastProfile,
  INVENTORY_ADJUSTMENT_KINDS,
  INVENTORY_CATEGORIES,
  LIBRARY_FORMATS,
  LISTING_FORMS,
  LISTING_STATUSES,
  MEMBERSHIP_ROLES,
  PLANS,
  SOURCE_FORMS,
  SOURCE_TYPES,
} from '@hyphaehub/core';
import { createId } from '@paralleldrive/cuid2';
import { relations } from 'drizzle-orm';
import { index, integer, real, sqliteTable, text, unique } from 'drizzle-orm/sqlite-core';

// Re-export better-auth tables so a single schema entry covers every table.
export { account, session, user, verification } from './auth-schema';
import { user } from './auth-schema';

// ── Column helpers ────────────────────────────────────────────────────────────
const pk = () =>
  text('id')
    .primaryKey()
    .$defaultFn(() => createId());
const createdAt = () =>
  integer('created_at', { mode: 'timestamp_ms' })
    .notNull()
    .$defaultFn(() => new Date());
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
  /** Secret token for the public calendar (.ics) subscription feed; null = disabled. */
  calendarToken: text('calendar_token'),
  /** Workspace-level default forecast base times; overrides the built-in defaults,
   *  and is itself overridden per-strain. Null = use built-in defaults. */
  forecastProfile: text('forecast_profile', { mode: 'json' }).$type<ForecastProfile>(),
  // ── Buyer storefront (FARM tier) ──
  storefrontEnabled: integer('storefront_enabled', { mode: 'boolean' }).notNull().default(false),
  /** Show forecasted upcoming harvests to buyers. */
  storefrontShowForecast: integer('storefront_show_forecast', { mode: 'boolean' })
    .notNull()
    .default(false),
  /** How many days of predicted harvests to surface on the storefront. */
  storefrontForecastDays: integer('storefront_forecast_days').notNull().default(21),
  storefrontBlurb: text('storefront_blurb'),
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
    // ── Provenance (how the genetics were acquired) ──
    sourceForm: text('source_form', { enum: SOURCE_FORMS }),
    acquiredAt: ts('acquired_at'),
    /** The vendor's catalog name (distinct from the grower's commonName). */
    vendorStrainName: text('vendor_strain_name'),
    /** Species-identity evidence (e.g. an ITS sequencing note). */
    sequencingNote: text('sequencing_note'),
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
    /** When status became CONTAMINATED + the structured taxonomy (for rate analytics). */
    contaminatedAt: ts('contaminated_at'),
    contaminantType: text('contaminant_type', { enum: CONTAMINANT_TYPES }),
    contaminationCause: text('contamination_cause', { enum: CONTAMINATION_CAUSES }),
    // ── Culture library / vault (set when STORED as kept stock) ──
    libraryFormat: text('library_format', { enum: LIBRARY_FORMATS }),
    storageMethod: text('storage_method'),
    storageLocation: text('storage_location'),
    storedAt: ts('stored_at'),
    lastRevivedAt: ts('last_revived_at'),
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

// ── Environment readings (manual temp / humidity / CO₂ logs, batch time-series) ─
export const environmentReadings = sqliteTable(
  'environment_readings',
  {
    id: pk(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    batchId: text('batch_id').references(() => batches.id, { onDelete: 'cascade' }),
    cultureId: text('culture_id').references(() => cultures.id, { onDelete: 'set null' }),
    recordedAt: ts('recorded_at')
      .notNull()
      .$defaultFn(() => new Date()),
    /** Stored canonically in Celsius; clients convert for display. */
    tempC: real('temp_c'),
    humidityPct: real('humidity_pct'),
    co2Ppm: real('co2_ppm'),
    note: text('note'),
    createdAt: createdAt(),
  },
  (t) => [index('env_ws').on(t.workspaceId), index('env_batch').on(t.batchId, t.recordedAt)],
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
    occurredAt: ts('occurred_at')
      .notNull()
      .$defaultFn(() => new Date()),
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

// ── Log entries (grow journal: dated free-form notes, batch-scoped or global) ──
export const logEntries = sqliteTable(
  'log_entries',
  {
    id: pk(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    /** Optional batch this entry belongs to; null = workspace-wide journal note. */
    batchId: text('batch_id').references(() => batches.id, { onDelete: 'set null' }),
    body: text('body').notNull(),
    occurredAt: ts('occurred_at')
      .notNull()
      .$defaultFn(() => new Date()),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('log_entries_ws').on(t.workspaceId), index('log_entries_batch').on(t.batchId)],
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
    logEntryId: text('log_entry_id').references(() => logEntries.id, { onDelete: 'cascade' }),
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
    /** Warn when quantityOnHand drops to or below this (null = no reorder alert). */
    lowStockThreshold: real('low_stock_threshold'),
    supplier: text('supplier'),
    notes: text('notes'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('inventory_ws').on(t.workspaceId)],
);

// ── Inventory adjustments (audit ledger for manual stock changes) ────────────
export const inventoryAdjustments = sqliteTable(
  'inventory_adjustments',
  {
    id: pk(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    inventoryItemId: text('inventory_item_id')
      .notNull()
      .references(() => inventoryItems.id, { onDelete: 'cascade' }),
    /** Signed change applied to quantityOnHand (negative for loss/usage). */
    delta: real('delta').notNull(),
    /** Resulting quantityOnHand after the change (for a readable history). */
    balanceAfter: real('balance_after').notNull(),
    kind: text('kind', { enum: INVENTORY_ADJUSTMENT_KINDS }).notNull().default('CORRECTION'),
    /** For a LOSS: why the stock was written off. */
    reason: text('reason'),
    note: text('note'),
    createdAt: createdAt(),
  },
  (t) => [index('inv_adj_ws').on(t.workspaceId), index('inv_adj_item').on(t.inventoryItemId)],
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

// ── Marketplace: buyers (purchasers invited to a farm's storefront) ───────────
export const buyers = sqliteTable(
  'buyers',
  {
    id: pk(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    email: text('email').notNull(),
    name: text('name'),
    status: text('status', { enum: BUYER_STATUSES }).notNull().default('INVITED'),
    /** Last time the buyer opened the storefront. */
    lastSeenAt: ts('last_seen_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('buyers_ws_email').on(t.workspaceId, t.email),
    index('buyers_ws').on(t.workspaceId),
  ],
);

// ── Marketplace: buyer auth tokens (magic-link login + session), hashed ───────
export const buyerTokens = sqliteTable(
  'buyer_tokens',
  {
    id: pk(),
    buyerId: text('buyer_id')
      .notNull()
      .references(() => buyers.id, { onDelete: 'cascade' }),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    /** SHA-256 hex of the token; the plaintext is never stored. */
    tokenHash: text('token_hash').notNull(),
    /** 'LOGIN' = short-lived one-time magic link; 'SESSION' = long-lived bearer. */
    purpose: text('purpose', { enum: ['LOGIN', 'SESSION'] }).notNull(),
    expiresAt: ts('expires_at').notNull(),
    createdAt: createdAt(),
  },
  (t) => [index('buyer_tokens_hash').on(t.tokenHash), index('buyer_tokens_buyer').on(t.buyerId)],
);

// ── Marketplace: listings (harvested product offered for sale) ────────────────
export const listings = sqliteTable(
  'listings',
  {
    id: pk(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    harvestId: text('harvest_id').references(() => harvests.id, { onDelete: 'set null' }),
    batchId: text('batch_id').references(() => batches.id, { onDelete: 'set null' }),
    strainId: text('strain_id').references(() => strains.id, { onDelete: 'set null' }),
    title: text('title').notNull(),
    form: text('form', { enum: LISTING_FORMS }).notNull().default('FRESH'),
    /** Total sellable quantity, grams. Available = quantityG − approved/pending dibs. */
    quantityG: real('quantity_g').notNull().default(0),
    /** Price per kg in cents; null = "contact for price". */
    pricePerKgCents: integer('price_per_kg_cents'),
    availableAt: ts('available_at'),
    status: text('status', { enum: LISTING_STATUSES }).notNull().default('AVAILABLE'),
    notes: text('notes'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('listings_ws').on(t.workspaceId), index('listings_status').on(t.status)],
);

// ── Marketplace: dibs (buyer reservation requests; farm approves) ─────────────
export const dibs = sqliteTable(
  'dibs',
  {
    id: pk(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    buyerId: text('buyer_id')
      .notNull()
      .references(() => buyers.id, { onDelete: 'cascade' }),
    /** A dib is on a listing (available now) or a batch (predicted pre-order). */
    listingId: text('listing_id').references(() => listings.id, { onDelete: 'set null' }),
    batchId: text('batch_id').references(() => batches.id, { onDelete: 'set null' }),
    requestedQtyG: real('requested_qty_g'),
    status: text('status', { enum: DIB_STATUSES }).notNull().default('PENDING'),
    note: text('note'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('dibs_ws').on(t.workspaceId, t.status),
    index('dibs_buyer').on(t.buyerId),
    index('dibs_listing').on(t.listingId),
  ],
);

// ── Marketplace: strain votes (buyers vote for what the farm grows next) ──────
export const strainVotes = sqliteTable(
  'strain_votes',
  {
    id: pk(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    buyerId: text('buyer_id')
      .notNull()
      .references(() => buyers.id, { onDelete: 'cascade' }),
    strainId: text('strain_id')
      .notNull()
      .references(() => strains.id, { onDelete: 'cascade' }),
    createdAt: createdAt(),
  },
  (t) => [
    // One vote per buyer per strain, scoped by workspace (presets are shared, so the
    // workspace must be part of the key or a preset vote would leak across farms).
    unique('strain_votes_buyer_strain').on(t.workspaceId, t.buyerId, t.strainId),
    index('strain_votes_ws_strain').on(t.workspaceId, t.strainId),
  ],
);

// ── Early-access / waitlist signups (platform-level, pre-launch demand capture) ─
export const waitlistSignups = sqliteTable(
  'waitlist_signups',
  {
    id: pk(),
    email: text('email').notNull(),
    name: text('name'),
    /** Where the signup came from, e.g. 'splash' | 'early-access'. */
    source: text('source'),
    referrer: text('referrer'),
    status: text('status', { enum: ['PENDING', 'INVITED'] })
      .notNull()
      .default('PENDING'),
    createdAt: createdAt(),
  },
  (t) => [unique('waitlist_email').on(t.email)],
);

// ── Cloud Connect links (a cloud user ↔ their self-hosted instance) ───────────
// Recorded by the official cloud app when a user connects to their own server,
// so the platform admin can see, verify (ping /health) and revoke live links.
export const connectLinks = sqliteTable(
  'connect_links',
  {
    id: pk(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    /** The self-hosted instance's public base URL (origin, no trailing slash). */
    serverUrl: text('server_url').notNull(),
    label: text('label'),
    /** Last time the app reported this link in use. */
    lastSeenAt: integer('last_seen_at', { mode: 'timestamp_ms' })
      .notNull()
      .$defaultFn(() => new Date()),
    /** Last admin reachability check and its outcome ('ok' | 'unreachable'). */
    lastVerifiedAt: ts('last_verified_at'),
    lastStatus: text('last_status'),
    createdAt: createdAt(),
  },
  (t) => [
    unique('connect_links_user_server').on(t.userId, t.serverUrl),
    index('connect_links_user').on(t.userId),
  ],
);

// ── Self-host telemetry (anonymous install pings) ────────────────────────────
// One row per self-hosted install, keyed by an anonymous random id the instance
// persists in its data volume. No account link, no personal data, no IP.
export const installs = sqliteTable('installs', {
  id: pk(),
  /** Anonymous, instance-generated id (random hex). */
  installId: text('install_id').notNull().unique(),
  version: text('version'),
  firstSeenAt: integer('first_seen_at', { mode: 'timestamp_ms' })
    .notNull()
    .$defaultFn(() => new Date()),
  lastSeenAt: integer('last_seen_at', { mode: 'timestamp_ms' })
    .notNull()
    .$defaultFn(() => new Date()),
  pingCount: integer('ping_count').notNull().default(1),
  createdAt: createdAt(),
});

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
  logEntries: many(logEntries),
  environmentReadings: many(environmentReadings),
}));

export const environmentReadingsRelations = relations(environmentReadings, ({ one }) => ({
  workspace: one(workspaces, {
    fields: [environmentReadings.workspaceId],
    references: [workspaces.id],
  }),
  batch: one(batches, { fields: [environmentReadings.batchId], references: [batches.id] }),
}));

export const logEntriesRelations = relations(logEntries, ({ one, many }) => ({
  workspace: one(workspaces, { fields: [logEntries.workspaceId], references: [workspaces.id] }),
  batch: one(batches, { fields: [logEntries.batchId], references: [batches.id] }),
  photos: many(photos),
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
