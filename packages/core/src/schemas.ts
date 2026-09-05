import { z } from 'zod';
import {
  BATCH_STATUSES,
  CONTAINER_TYPES,
  COST_CATEGORIES,
  CULTURE_STATUSES,
  CULTURE_TYPES,
  EVENT_TYPES,
  INVENTORY_CATEGORIES,
  MEMBERSHIP_ROLES,
  PLANS,
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
/** Increment (restock) or decrement (consume) stock on hand. */
export const inventoryAdjustSchema = z.object({
  delta: z.number(),
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
export type InventoryItemCreateInput = z.input<typeof inventoryItemCreateSchema>;
export type InventoryItemUpdateInput = z.input<typeof inventoryItemUpdateSchema>;
export type InventoryAdjustInput = z.input<typeof inventoryAdjustSchema>;
export type CostEntryCreateInput = z.input<typeof costEntryCreateSchema>;
export type CostEntryUpdateInput = z.input<typeof costEntryUpdateSchema>;
