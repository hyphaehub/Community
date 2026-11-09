import {
  type ContaminantType,
  type ContaminationCause,
  type CultureStatus,
  type CultureType,
  type EventType,
  LIFECYCLE_ORDER,
  type LibraryFormat,
  type SourceForm,
} from './enums';

const TERMINAL: CultureStatus[] = ['CONTAMINATED', 'SPENT', 'STORED'];

/** Whether a culture status is a terminal/branch state (not part of progress). */
export function isTerminal(status: CultureStatus): boolean {
  return TERMINAL.includes(status);
}

/** Progress through the linear lifecycle, 0..1. Terminal states return 1. */
export function lifecycleProgress(status: CultureStatus): number {
  if (isTerminal(status)) return status === 'CONTAMINATED' ? 0 : 1;
  const idx = LIFECYCLE_ORDER.indexOf(status);
  if (idx < 0) return 0;
  return idx / (LIFECYCLE_ORDER.length - 1);
}

/** Human-readable labels for enums (shared by web + mobile). */
export const STATUS_LABELS: Record<CultureStatus, string> = {
  PREPPING: 'Prepping',
  INOCULATED: 'Inoculated',
  COLONIZING: 'Colonizing',
  COLONIZED: 'Fully colonized',
  FRUITING: 'Fruiting',
  HARVESTING: 'Harvesting',
  CONTAMINATED: 'Contaminated',
  SPENT: 'Spent',
  STORED: 'Stored',
};

export const CULTURE_TYPE_LABELS: Record<CultureType, string> = {
  SOURCE: 'Source',
  AGAR: 'Agar plate',
  LIQUID_CULTURE: 'Liquid culture',
  GRAIN: 'Grain spawn',
  BULK: 'Bulk / tub',
};

export const EVENT_LABELS: Record<EventType, string> = {
  INOCULATION: 'Inoculated',
  COLONIZATION_CHECK: 'Colonization check',
  CONTAMINATION: 'Contamination',
  SPAWN_TO_BULK: 'Spawned to bulk',
  FRUITING_CONDITIONS: 'Fruiting conditions',
  PINNING: 'Pinning',
  HARVEST: 'Harvest',
  DRYING: 'Drying',
  STORED: 'Stored',
  NOTE: 'Note',
};

export const CONTAMINANT_TYPE_LABELS: Record<ContaminantType, string> = {
  TRICHODERMA: 'Trichoderma (green mold)',
  COBWEB: 'Cobweb mold',
  BACTERIAL: 'Bacterial (wet, sour)',
  WET_SPOT: 'Wet spot / bacterial blotch',
  BLACK_MOLD: 'Black mold (Aspergillus)',
  GREEN_MOLD: 'Green mold (Penicillium)',
  PINK_MOLD: 'Pink mold (Neurospora)',
  YEAST: 'Yeast',
  MITES: 'Mites',
  UNKNOWN: 'Unknown',
  OTHER: 'Other',
};

export const SOURCE_FORM_LABELS: Record<SourceForm, string> = {
  SPORE_PRINT: 'Spore print',
  SPORE_SYRINGE: 'Spore syringe',
  LIQUID_CULTURE: 'Liquid culture',
  AGAR: 'Agar culture',
  CLONE: 'Clone (tissue)',
  COMMERCIAL_CULTURE: 'Commercial culture',
  GIFT: 'Gift / swap',
  OTHER: 'Other',
};

export const LIBRARY_FORMAT_LABELS: Record<LibraryFormat, string> = {
  AGAR_PLATE: 'Agar plate',
  AGAR_SLANT: 'Agar slant',
  LIQUID_CULTURE: 'Liquid culture',
  CRYO: 'Cryo (glycerol)',
  SPORE_PRINT: 'Spore print',
  SPORE_SYRINGE: 'Spore syringe',
  GRAIN: 'Grain master',
  OTHER: 'Other',
};

export const CONTAMINATION_CAUSE_LABELS: Record<ContaminationCause, string> = {
  STERILE_TECHNIQUE: 'Sterile technique slip',
  SUBSTRATE_PREP: 'Substrate prep',
  UNDER_STERILIZED: 'Under-sterilized',
  ENVIRONMENTAL: 'Environmental / air',
  GRAIN_QUALITY: 'Grain quality',
  CONTAMINATED_SOURCE: 'Contaminated source/genetics',
  SLOW_COLONIZATION: 'Slow colonization',
  UNKNOWN: 'Unknown',
  OTHER: 'Other',
};
