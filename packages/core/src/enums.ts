/**
 * Canonical enums for the HyphaeHub cultivation lifecycle.
 * Declared as `as const` tuples so they can back both Zod `z.enum(...)`
 * and Drizzle text columns without duplication.
 */

/** Subscription / edition plans. */
export const PLANS = ['FREE', 'PRO', 'FARM'] as const;
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
