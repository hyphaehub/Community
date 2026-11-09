import { z } from 'zod';
import {
  BATCH_STATUSES,
  CONTAINER_TYPES,
  CONTAMINANT_TYPES,
  CONTAMINATION_CAUSES,
  COST_CATEGORIES,
  CULTURE_STATUSES,
  CULTURE_TYPES,
  EVENT_TYPES,
  INVENTORY_ADJUSTMENT_KINDS,
  INVENTORY_CATEGORIES,
  INVENTORY_LOSS_REASONS,
  LIBRARY_FORMATS,
  LISTING_FORMS,
  LISTING_STATUSES,
  MEMBERSHIP_ROLES,
  PLANS,
  SOURCE_FORMS,
  SOURCE_TYPES,
} from './enums';

/** ISO-8601 datetime string (or plain date). Kept permissive for client input. */
const isoDate = z.string().min(1);
const optionalDate = isoDate.optional().nullable();
const id = z.string().min(1);
const cents = z.number().int();

// ── Workspace ────────────────────────────────────────────────────────────────
export const workspaceUpdateSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  plan: z.enum(PLANS).optional(),
});

// ── Organization (a.k.a. farm / workspace) & membership ──────────────────────
export const orgCreateSchema = z.object({
  name: z.string().min(1).max(120),
});
export const orgUpdateSchema = z.object({
  name: z.string().min(1).max(120),
});
/** Add a member to an org by email; the invitee must already have an account. */
export const memberAddSchema = z.object({
  email: z.string().email(),
  role: z.enum(MEMBERSHIP_ROLES).default('MEMBER'),
});
export const memberRoleSchema = z.object({
  role: z.enum(MEMBERSHIP_ROLES),
});

// ── Feature flags ────────────────────────────────────────────────────────────
export const featureToggleSchema = z.object({
  key: z.string().min(1).max(64),
  enabled: z.boolean().nullable(),
});
export const platformDefaultsSchema = z.object({
  defaults: z.record(z.boolean()),
});

// ── Jars (pre-batch sterilized grain jars; behind the 'jars' feature flag) ────
export const jarCreateSchema = z.object({
  count: z.number().int().min(1).max(500),
  labelPrefix: z.string().max(80).optional(),
  status: z.enum(CULTURE_STATUSES).default('PREPPING'),
  containerType: z.enum(CONTAINER_TYPES).default('JAR'),
  grainType: z.string().max(120).optional(),
  /** Grain amount consumed per jar, in the inventory item's unit. */
  quantity: z.number().nonnegative().optional(),
  quantityUnit: z.string().max(24).optional(),
  /** Grain inventory item to draw down. */
  inventoryItemId: id.optional().nullable(),
  /** Explicit total cost override (else computed from the inventory unit cost). */
  costCents: cents.nonnegative().optional(),
  strainId: id.optional().nullable(),
  inoculatedAt: optionalDate,
});
export const jarAssignSchema = z.object({
  batchId: id,
  jarIds: z.array(id).min(1).max(200),
});

// ── Strain ───────────────────────────────────────────────────────────────────
/** Category is a free-form string so orgs can add their own; built-ins live in STRAIN_CATEGORIES. */
export const strainCreateSchema = z.object({
  commonName: z.string().min(1).max(120),
  species: z.string().max(120).optional().nullable(),
  category: z.string().min(1).max(60).default('GOURMET'),
  vendor: z.string().max(120).optional().nullable(),
  optimalTempMinC: z.number().optional().nullable(),
  optimalTempMaxC: z.number().optional().nullable(),
  notes: z.string().max(2000).optional().nullable(),
  // Provenance (how the genetics were acquired).
  sourceForm: z.enum(SOURCE_FORMS).optional().nullable(),
  acquiredAt: optionalDate,
  /** The vendor's catalog name, kept distinct from the grower's own commonName. */
  vendorStrainName: z.string().max(120).optional().nullable(),
  /** Species-identity evidence (e.g. an ITS sequencing note). */
  sequencingNote: z.string().max(2000).optional().nullable(),
});
export const strainUpdateSchema = strainCreateSchema.partial();

/** A custom strain category (per org). */
export const strainCategoryCreateSchema = z.object({
  name: z.string().min(1).max(60),
});

// ── Batch (named run + cost/yield anchor) ────────────────────────────────────
export const batchCreateSchema = z.object({
  name: z.string().min(1).max(120),
  strainId: id.optional().nullable(),
  status: z.enum(BATCH_STATUSES).default('ACTIVE'),
  goalDryWeightG: z.number().nonnegative().optional().nullable(),
  startedAt: optionalDate,
  completedAt: optionalDate,
  notes: z.string().max(2000).optional().nullable(),
});
export const batchUpdateSchema = batchCreateSchema.partial();

// ── Culture (polymorphic lifecycle unit / lineage node) ──────────────────────
export const cultureCreateSchema = z.object({
  type: z.enum(CULTURE_TYPES),
  label: z.string().min(1).max(120),
  batchId: id.optional().nullable(),
  strainId: id.optional().nullable(),
  status: z.enum(CULTURE_STATUSES).default('PREPPING'),
  sourceType: z.enum(SOURCE_TYPES).optional().nullable(),
  containerType: z.enum(CONTAINER_TYPES).optional().nullable(),
  /** Grain type (for GRAIN) or bulk substrate recipe (for BULK). */
  substrateType: z.string().max(120).optional().nullable(),
  quantity: z.number().nonnegative().optional().nullable(),
  quantityUnit: z.string().max(24).optional().nullable(),
  /** Dry substrate weight in grams (BULK) — used for biological efficiency. */
  drySubstrateG: z.number().nonnegative().optional().nullable(),
  vendorSource: z.string().max(160).optional().nullable(),
  colonizationPct: z.number().min(0).max(100).optional().nullable(),
  inoculatedAt: optionalDate,
  notes: z.string().max(2000).optional().nullable(),
});
export const cultureUpdateSchema = cultureCreateSchema.partial();

/** Split a source (or grain) into N children — e.g. one LC → several grain jars. */
export const splitCultureSchema = z.object({
  count: z.number().int().min(1).max(100),
  type: z.enum(CULTURE_TYPES).default('GRAIN'),
  labelPrefix: z.string().max(80).optional(),
  containerType: z.enum(CONTAINER_TYPES).default('JAR'),
  substrateType: z.string().max(120).optional(),
  quantity: z.number().nonnegative().optional(),
  quantityUnit: z.string().max(24).optional(),
  status: z.enum(CULTURE_STATUSES).default('INOCULATED'),
  batchId: id.optional().nullable(),
  inoculatedAt: optionalDate,
  /** Optional per-child cost, auto-logged as a cost entry against the batch. */
  costPerChildCents: cents.nonnegative().optional(),
});

/** Combine one or more parents (jars) into a single BULK tub. */
export const combineCulturesSchema = z.object({
  parentIds: z.array(id).min(1).max(20),
  label: z.string().min(1).max(120),
  type: z.enum(CULTURE_TYPES).default('BULK'),
  containerType: z.enum(CONTAINER_TYPES).default('MONOTUB'),
  substrateType: z.string().max(120).optional(),
  drySubstrateG: z.number().nonnegative().optional(),
  quantity: z.number().nonnegative().optional(),
  quantityUnit: z.string().max(24).optional(),
  batchId: id.optional().nullable(),
  status: z.enum(CULTURE_STATUSES).default('COLONIZING'),
  spawnToBulkAt: optionalDate,
  /** Optional bulk-substrate cost, auto-logged against the batch. */
  substrateCostCents: cents.nonnegative().optional(),
});

// ── Event / observation ──────────────────────────────────────────────────────
export const eventCreateSchema = z.object({
  cultureId: id,
  type: z.enum(EVENT_TYPES),
  occurredAt: optionalDate,
  note: z.string().max(2000).optional().nullable(),
  data: z.record(z.any()).optional().nullable(),
});
export const eventUpdateSchema = eventCreateSchema.partial().omit({ cultureId: true });

// ── Harvest / flush ──────────────────────────────────────────────────────────
export const harvestCreateSchema = z.object({
  cultureId: id,
  batchId: id.optional().nullable(),
  flushNumber: z.number().int().min(1).default(1),
  wetWeightG: z.number().nonnegative(),
  dryWeightG: z.number().nonnegative().optional().nullable(),
  harvestedAt: optionalDate,
  driedAt: optionalDate,
  notes: z.string().max(2000).optional().nullable(),
});
export const harvestUpdateSchema = harvestCreateSchema.partial().omit({ cultureId: true });

// ── Contamination (mark a culture contaminated with structured taxonomy) ──────
export const contaminationSchema = z.object({
  contaminantType: z.enum(CONTAMINANT_TYPES).default('UNKNOWN'),
  contaminationCause: z.enum(CONTAMINATION_CAUSES).optional().nullable(),
  contaminatedAt: optionalDate,
  note: z.string().max(2000).optional().nullable(),
});

// ── Environment reading (manual temp / humidity / CO₂ log) ────────────────────
export const environmentReadingCreateSchema = z
  .object({
    batchId: id.optional().nullable(),
    cultureId: id.optional().nullable(),
    /** Temperature in Celsius (clients convert for display). */
    tempC: z.number().min(-20).max(80).optional().nullable(),
    humidityPct: z.number().min(0).max(100).optional().nullable(),
    co2Ppm: z.number().min(0).max(100000).optional().nullable(),
    recordedAt: optionalDate,
    note: z.string().max(500).optional().nullable(),
  })
  .refine((v) => v.tempC != null || v.humidityPct != null || v.co2Ppm != null, {
    message: 'Enter at least one of temperature, humidity, or CO₂.',
  });

// ── Log entry (grow journal: dated free-form notes, batch-scoped or global) ───
export const logEntryCreateSchema = z.object({
  body: z.string().min(1).max(5000),
  /** Batch this note belongs to; omit/null for a workspace-wide journal entry. */
  batchId: id.optional().nullable(),
  occurredAt: optionalDate,
});
export const logEntryUpdateSchema = logEntryCreateSchema.partial();

// ── Inventory item ───────────────────────────────────────────────────────────
export const inventoryItemCreateSchema = z.object({
  name: z.string().min(1).max(120),
  category: z.enum(INVENTORY_CATEGORIES).default('OTHER'),
  unit: z.string().max(24).default('unit'),
  unitCostCents: cents.nonnegative().default(0),
  quantityOnHand: z.number().default(0),
  /** Reorder alert threshold; qty at/below this is "low stock". Null = no alert. */
  lowStockThreshold: z.number().nonnegative().optional().nullable(),
  supplier: z.string().max(120).optional().nullable(),
  notes: z.string().max(2000).optional().nullable(),
});
export const inventoryItemUpdateSchema = inventoryItemCreateSchema.partial();
/** Increment (restock) or decrement (loss/usage/correction) stock on hand. */
export const inventoryAdjustSchema = z.object({
  delta: z.number(),
  kind: z.enum(INVENTORY_ADJUSTMENT_KINDS).default('CORRECTION'),
  /** For a LOSS: why the stock was written off. */
  reason: z.enum(INVENTORY_LOSS_REASONS).optional().nullable(),
  note: z.string().max(200).optional().nullable(),
});

// ── Cost entry ───────────────────────────────────────────────────────────────
export const costEntryCreateSchema = z.object({
  description: z.string().min(1).max(200),
  category: z.enum(COST_CATEGORIES).default('MATERIALS'),
  amountCents: cents.nonnegative(),
  batchId: id.optional().nullable(),
  cultureId: id.optional().nullable(),
  inventoryItemId: id.optional().nullable(),
  quantity: z.number().optional().nullable(),
  occurredAt: optionalDate,
});
export const costEntryUpdateSchema = costEntryCreateSchema.partial();

// ── Culture library / vault (store stock + revive) ───────────────────────────
export const libraryStoreSchema = z.object({
  format: z.enum(LIBRARY_FORMATS).default('AGAR_PLATE'),
  storageMethod: z.string().max(120).optional().nullable(),
  storageLocation: z.string().max(120).optional().nullable(),
  storedAt: optionalDate,
  note: z.string().max(1000).optional().nullable(),
});
/** Patch a stored culture's library fields (and optionally mark it revived now). */
export const libraryUpdateSchema = libraryStoreSchema.partial().extend({
  lastRevivedAt: optionalDate,
});

/** Add a purchased / standalone source straight into the library (e.g. a spore syringe). */
export const libraryCreateSchema = z.object({
  label: z.string().min(1).max(120),
  strainId: id.optional().nullable(),
  format: z.enum(LIBRARY_FORMATS).default('SPORE_SYRINGE'),
  storageMethod: z.string().max(120).optional().nullable(),
  storageLocation: z.string().max(120).optional().nullable(),
  storedAt: optionalDate,
  quantity: z.number().nonnegative().optional().nullable(),
  quantityUnit: z.string().max(24).optional().nullable(),
  note: z.string().max(2000).optional().nullable(),
});

/**
 * Draw N children from a stored library source — e.g. a spore syringe → several
 * grain jars into a grow batch, or → a liquid culture kept as library stock. The
 * source is reusable and is never consumed.
 */
export const libraryDrawSchema = z
  .object({
    count: z.number().int().min(1).max(100),
    type: z.enum(CULTURE_TYPES).default('GRAIN'),
    labelPrefix: z.string().max(80).optional(),
    containerType: z.enum(CONTAINER_TYPES).default('JAR'),
    substrateType: z.string().max(120).optional().nullable(),
    quantity: z.number().nonnegative().optional().nullable(),
    quantityUnit: z.string().max(24).optional().nullable(),
    inoculatedAt: optionalDate,
    costPerChildCents: cents.nonnegative().optional(),
    /** 'batch' sends the children into a grow; 'library' keeps them as stored stock. */
    destination: z.enum(['batch', 'library']).default('batch'),
    batchId: id.optional().nullable(),
    newBatchName: z.string().min(1).max(120).optional().nullable(),
    libraryFormat: z.enum(LIBRARY_FORMATS).optional().nullable(),
    storageLocation: z.string().max(120).optional().nullable(),
  })
  .refine((d) => d.destination !== 'batch' || !!d.batchId || !!d.newBatchName, {
    message: 'Pick an existing batch or name a new one.',
    path: ['batchId'],
  });

// ── Forecast base times (workspace-level default stage durations) ─────────────
export const forecastProfileSettingsSchema = z.object({
  /** Inoculation → spawn to bulk (grain colonization), days. */
  colonization: z.number().int().min(1).max(180),
  /** Spawn → fruiting conditions (bulk colonization), days. */
  bulkColonization: z.number().int().min(1).max(180),
  /** Fruiting → first harvest, days. */
  firstFlush: z.number().int().min(1).max(180),
  /** Between consecutive flushes, days. */
  flushGap: z.number().int().min(1).max(180),
  /** How many flushes to project. */
  flushes: z.number().int().min(1).max(8),
});

// ── Marketplace / storefront (FARM tier) ──────────────────────────────────────
export const storefrontSettingsSchema = z.object({
  enabled: z.boolean().optional(),
  /** Show the farm's forecasted upcoming harvests to buyers. */
  showForecast: z.boolean().optional(),
  /** How many days ahead of predicted harvests to surface. */
  forecastDays: z.number().int().min(1).max(120).optional(),
  blurb: z.string().max(2000).optional().nullable(),
});

/** Invite a buyer (purchaser) to the storefront by email. */
export const buyerInviteSchema = z.object({
  email: z.string().email(),
  name: z.string().max(160).optional().nullable(),
});

/** List harvested product for sale. `harvestId` links the source harvest. */
export const listingCreateSchema = z.object({
  title: z.string().min(1).max(160),
  form: z.enum(LISTING_FORMS).default('FRESH'),
  harvestId: id.optional().nullable(),
  batchId: id.optional().nullable(),
  strainId: id.optional().nullable(),
  /** Sellable quantity in grams. */
  quantityG: z.number().nonnegative(),
  /** Price in cents per kg (null = contact / market price). */
  pricePerKgCents: cents.nonnegative().optional().nullable(),
  /** When it's ready (null = available now). */
  availableAt: optionalDate,
  notes: z.string().max(2000).optional().nullable(),
  status: z.enum(LISTING_STATUSES).default('AVAILABLE'),
});
export const listingUpdateSchema = listingCreateSchema.partial();

/** A buyer "calls dibs": on a listing (available) or a batch (predicted pre-order). */
export const dibCreateSchema = z
  .object({
    listingId: id.optional().nullable(),
    batchId: id.optional().nullable(),
    requestedQtyG: z.number().positive().optional().nullable(),
    note: z.string().max(1000).optional().nullable(),
  })
  .refine((v) => !!v.listingId || !!v.batchId, {
    message: 'Dibs must reference a listing or a predicted batch.',
  });

/** Buyer exchanges a magic-link login token for a session. */
export const portalSessionSchema = z.object({
  token: z.string().min(10),
});

/** A buyer casts (or the request to cast) a vote for a strain to grow next. */
export const voteCreateSchema = z.object({
  strainId: id,
});

/** Public early-access / waitlist signup (no auth). `hp` is a spam honeypot. */
export const waitlistSignupSchema = z.object({
  email: z.string().email().max(254),
  name: z.string().max(120).optional().nullable(),
  source: z.string().max(40).optional().nullable(),
  hp: z.string().max(200).optional(), // honeypot: humans leave this empty; the route drops it if filled
});

// ── Inferred DTO types ───────────────────────────────────────────────────────
export type WorkspaceUpdateInput = z.input<typeof workspaceUpdateSchema>;
export type OrgCreateInput = z.input<typeof orgCreateSchema>;
export type OrgUpdateInput = z.input<typeof orgUpdateSchema>;
export type MemberAddInput = z.input<typeof memberAddSchema>;
export type MemberRoleInput = z.input<typeof memberRoleSchema>;
export type JarCreateInput = z.input<typeof jarCreateSchema>;
export type JarAssignInput = z.input<typeof jarAssignSchema>;
export type FeatureToggleInput = z.input<typeof featureToggleSchema>;
export type PlatformDefaultsInput = z.input<typeof platformDefaultsSchema>;
export type StrainCreateInput = z.input<typeof strainCreateSchema>;
export type StrainUpdateInput = z.input<typeof strainUpdateSchema>;
export type StrainCategoryCreateInput = z.input<typeof strainCategoryCreateSchema>;
export type BatchCreateInput = z.input<typeof batchCreateSchema>;
export type BatchUpdateInput = z.input<typeof batchUpdateSchema>;
export type CultureCreateInput = z.input<typeof cultureCreateSchema>;
export type CultureUpdateInput = z.input<typeof cultureUpdateSchema>;
export type SplitCultureInput = z.input<typeof splitCultureSchema>;
export type CombineCulturesInput = z.input<typeof combineCulturesSchema>;
export type EventCreateInput = z.input<typeof eventCreateSchema>;
export type EventUpdateInput = z.input<typeof eventUpdateSchema>;
export type HarvestCreateInput = z.input<typeof harvestCreateSchema>;
export type HarvestUpdateInput = z.input<typeof harvestUpdateSchema>;
export type LogEntryCreateInput = z.input<typeof logEntryCreateSchema>;
export type LogEntryUpdateInput = z.input<typeof logEntryUpdateSchema>;
export type ContaminationInput = z.input<typeof contaminationSchema>;
export type EnvironmentReadingCreateInput = z.input<typeof environmentReadingCreateSchema>;
export type ForecastProfileSettingsInput = z.input<typeof forecastProfileSettingsSchema>;
export type LibraryStoreInput = z.input<typeof libraryStoreSchema>;
export type LibraryUpdateInput = z.input<typeof libraryUpdateSchema>;
export type LibraryCreateInput = z.input<typeof libraryCreateSchema>;
export type LibraryDrawInput = z.input<typeof libraryDrawSchema>;
export type StorefrontSettingsInput = z.input<typeof storefrontSettingsSchema>;
export type BuyerInviteInput = z.input<typeof buyerInviteSchema>;
export type ListingCreateInput = z.input<typeof listingCreateSchema>;
export type ListingUpdateInput = z.input<typeof listingUpdateSchema>;
export type DibCreateInput = z.input<typeof dibCreateSchema>;
export type PortalSessionInput = z.input<typeof portalSessionSchema>;
export type VoteCreateInput = z.input<typeof voteCreateSchema>;
export type WaitlistSignupInput = z.input<typeof waitlistSignupSchema>;
export type InventoryItemCreateInput = z.input<typeof inventoryItemCreateSchema>;
export type InventoryItemUpdateInput = z.input<typeof inventoryItemUpdateSchema>;
export type InventoryAdjustInput = z.input<typeof inventoryAdjustSchema>;
export type CostEntryCreateInput = z.input<typeof costEntryCreateSchema>;
export type CostEntryUpdateInput = z.input<typeof costEntryUpdateSchema>;
