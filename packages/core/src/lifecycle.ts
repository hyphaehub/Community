import {
  type CultureStatus,
  type CultureType,
  type EventType,
  LIFECYCLE_ORDER,
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
