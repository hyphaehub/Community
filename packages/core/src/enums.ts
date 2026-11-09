/**
 * Canonical enums for the HyphaeHub cultivation lifecycle.
 * Declared as `as const` tuples so they can back both Zod `z.enum(...)`
 * and Drizzle text columns without duplication.
 */

/** Subscription / edition plans. CONNECT = self-host your data, use the official clients. */
export const PLANS = ['FREE', 'PRO', 'FARM', 'CONNECT'] as const;
export type Plan = (typeof PLANS)[number];

/** Role of a member within a workspace. */
export const MEMBERSHIP_ROLES = ['OWNER', 'ADMIN', 'MEMBER', 'VIEWER'] as const;
export type MembershipRole = (typeof MEMBERSHIP_ROLES)[number];

/**
 * The kind of physical unit in the grow. Every node in the lineage graph is a
 * culture with one of these types:
 *  SOURCE          the origin (spore syringe/print, clone, commercial culture)
 *  AGAR            an agar plate
 *  LIQUID_CULTURE  a liquid culture (LC) jar/syringe
 *  GRAIN           colonized grain spawn (jars/bags)
 *  BULK            a fruiting container (monotub, bag, tray) — where flushes happen
 */
export const CULTURE_TYPES = ['SOURCE', 'AGAR', 'LIQUID_CULTURE', 'GRAIN', 'BULK'] as const;
export type CultureType = (typeof CULTURE_TYPES)[number];

/** Origin kind for a SOURCE culture. */
export const SOURCE_TYPES = [
  'SPORE_SYRINGE',
  'SPORE_PRINT',
  'LIQUID_CULTURE',
  'AGAR_CULTURE',
  'CLONE',
  'COMMERCIAL_CULTURE',
  'OTHER',
] as const;
export type SourceType = (typeof SOURCE_TYPES)[number];

/** Lifecycle status of a culture. */
export const CULTURE_STATUSES = [
  'PREPPING',
  'INOCULATED',
  'COLONIZING',
  'COLONIZED',
  'FRUITING',
  'HARVESTING',
  'CONTAMINATED',
  'SPENT',
  'STORED',
] as const;
export type CultureStatus = (typeof CULTURE_STATUSES)[number];

/** Physical container a culture lives in. */
export const CONTAINER_TYPES = [
  'JAR',
  'BAG',
  'MONOTUB',
  'SHOEBOX',
  'TRAY',
  'PLATE',
  'SYRINGE',
  'VESSEL',
  'OTHER',
] as const;
export type ContainerType = (typeof CONTAINER_TYPES)[number];

/** Timeline event / observation types. */
export const EVENT_TYPES = [
  'INOCULATION',
  'COLONIZATION_CHECK',
  'CONTAMINATION',
  'SPAWN_TO_BULK',
  'FRUITING_CONDITIONS',
  'PINNING',
  'HARVEST',
  'DRYING',
  'STORED',
  'NOTE',
] as const;
export type EventType = (typeof EVENT_TYPES)[number];

/** High-level status of a batch (a named run / cost rollup anchor). */
export const BATCH_STATUSES = ['ACTIVE', 'COMPLETED', 'ABORTED', 'ARCHIVED'] as const;
export type BatchStatus = (typeof BATCH_STATUSES)[number];

/** Neutral, species-agnostic strain categories. */
export const STRAIN_CATEGORIES = ['GOURMET', 'FUNCTIONAL', 'WILD', 'OTHER'] as const;
export type StrainCategory = (typeof STRAIN_CATEGORIES)[number];

/** Inventory / consumable categories. */
export const INVENTORY_CATEGORIES = [
  'GRAIN',
  'SUBSTRATE',
  'SUPPLEMENT',
  'CONTAINER',
  'STERILIZATION',
  'EQUIPMENT',
  'OTHER',
] as const;
export type InventoryCategory = (typeof INVENTORY_CATEGORIES)[number];

/** Cost line-item categories. */
export const COST_CATEGORIES = [
  'MATERIALS',
  'CONSUMABLE',
  'EQUIPMENT',
  'UTILITIES',
  'LABOR',
  'OTHER',
] as const;
export type CostCategory = (typeof COST_CATEGORIES)[number];

/** Supported mass units for weights and yields. */
export const MASS_UNITS = ['g', 'kg', 'oz', 'lb'] as const;
export type MassUnit = (typeof MASS_UNITS)[number];

/** Why an inventory quantity was adjusted (manual stock changes). */
export const INVENTORY_ADJUSTMENT_KINDS = ['RESTOCK', 'LOSS', 'USAGE', 'CORRECTION'] as const;
export type InventoryAdjustmentKind = (typeof INVENTORY_ADJUSTMENT_KINDS)[number];

/** Reasons for a LOSS adjustment (stock written off). */
export const INVENTORY_LOSS_REASONS = [
  'CONTAMINATION',
  'SPILLAGE',
  'EXPIRED',
  'DAMAGED',
  'OTHER',
] as const;
export type InventoryLossReason = (typeof INVENTORY_LOSS_REASONS)[number];

/** What kind of contaminant took a culture (the taxonomy growers actually use). */
export const CONTAMINANT_TYPES = [
  'TRICHODERMA',
  'COBWEB',
  'BACTERIAL',
  'WET_SPOT',
  'BLACK_MOLD',
  'GREEN_MOLD',
  'PINK_MOLD',
  'YEAST',
  'MITES',
  'UNKNOWN',
  'OTHER',
] as const;
export type ContaminantType = (typeof CONTAMINANT_TYPES)[number];

/** Suspected root cause of a contamination (drives the "how do I stop this" analytics). */
export const CONTAMINATION_CAUSES = [
  'STERILE_TECHNIQUE',
  'SUBSTRATE_PREP',
  'UNDER_STERILIZED',
  'ENVIRONMENTAL',
  'GRAIN_QUALITY',
  'CONTAMINATED_SOURCE',
  'SLOW_COLONIZATION',
  'UNKNOWN',
  'OTHER',
] as const;
export type ContaminationCause = (typeof CONTAMINATION_CAUSES)[number];

// ── Genetics (provenance + culture library) ──────────────────────────────────
/** How a strain's genetics were originally acquired (provenance). */
export const SOURCE_FORMS = [
  'SPORE_PRINT',
  'SPORE_SYRINGE',
  'LIQUID_CULTURE',
  'AGAR',
  'CLONE',
  'COMMERCIAL_CULTURE',
  'GIFT',
  'OTHER',
] as const;
export type SourceForm = (typeof SOURCE_FORMS)[number];

/** Physical format a stored (library/vault) culture is kept in. */
export const LIBRARY_FORMATS = [
  'AGAR_PLATE',
  'AGAR_SLANT',
  'LIQUID_CULTURE',
  'CRYO',
  'SPORE_PRINT',
  'SPORE_SYRINGE',
  'GRAIN',
  'OTHER',
] as const;
export type LibraryFormat = (typeof LIBRARY_FORMATS)[number];

/** Default viability window (days) per storage format; null = effectively indefinite. */
export const LIBRARY_VIABILITY_DAYS: Record<LibraryFormat, number | null> = {
  AGAR_PLATE: 180,
  AGAR_SLANT: 365,
  LIQUID_CULTURE: 60,
  CRYO: null,
  SPORE_PRINT: 1825,
  SPORE_SYRINGE: 365,
  GRAIN: 30,
  OTHER: 180,
};

// ── Marketplace / buyer storefront (FARM tier) ───────────────────────────────
/** Status of a buyer (purchaser) invited to a farm's storefront. */
export const BUYER_STATUSES = ['INVITED', 'ACTIVE', 'DISABLED'] as const;
export type BuyerStatus = (typeof BUYER_STATUSES)[number];

/** Form a sellable listing takes. */
export const LISTING_FORMS = ['FRESH', 'DRIED', 'GROW_KIT', 'OTHER'] as const;
export type ListingForm = (typeof LISTING_FORMS)[number];

/** Visibility/availability of a listing on the storefront. */
export const LISTING_STATUSES = ['AVAILABLE', 'HIDDEN', 'SOLD_OUT'] as const;
export type ListingStatus = (typeof LISTING_STATUSES)[number];

/** Lifecycle of a "dibs" reservation request (farm approves). */
export const DIB_STATUSES = ['PENDING', 'APPROVED', 'DECLINED', 'CANCELLED', 'FULFILLED'] as const;
export type DibStatus = (typeof DIB_STATUSES)[number];

/**
 * Ordered lifecycle stages used to render progress. Contamination/spent/stored
 * are terminal/branch states handled separately.
 */
export const LIFECYCLE_ORDER: CultureStatus[] = [
  'PREPPING',
  'INOCULATED',
  'COLONIZING',
  'COLONIZED',
  'FRUITING',
  'HARVESTING',
];
