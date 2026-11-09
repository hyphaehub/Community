import { CULTURE_TYPE_LABELS } from '@hyphaehub/core';
import { formatDate, formatMass } from './format';
import type { Batch, Culture, Harvest, InventoryItem, Strain } from './types';

/** Printable label content. Kept small so it fits common thermal label stock. */
export interface LabelData {
  key: string;
  title: string;
  subtitle?: string;
  meta?: string;
  /** QR target — deep link back into the app. */
  url: string;
  /** Short human code shown under the QR. */
  code: string;
}

/** Common thermal/label sizes (width × height). `page` feeds CSS `@page size`. */
export interface LabelSize {
  key: string;
  label: string;
  wmm: number;
  hmm: number;
  page: string;
}

export const LABEL_SIZES: LabelSize[] = [
  { key: '2x1', label: '2" × 1" (51 × 25 mm)', wmm: 51, hmm: 25, page: '51mm 25mm' },
  { key: '2.25x1.25', label: '2.25" × 1.25" (57 × 32 mm)', wmm: 57, hmm: 32, page: '57mm 32mm' },
  { key: '1.5x1', label: '1.5" × 1" (38 × 25 mm)', wmm: 38, hmm: 25, page: '38mm 25mm' },
  { key: '4x2', label: '4" × 2" (102 × 51 mm)', wmm: 102, hmm: 51, page: '102mm 51mm' },
];

export const DEFAULT_LABEL_SIZE = LABEL_SIZES[0] as LabelSize;

export function labelSizeByKey(key: string): LabelSize {
  return LABEL_SIZES.find((s) => s.key === key) ?? DEFAULT_LABEL_SIZE;
}

/** App origin for QR deep links (works in dev and prod). */
function appOrigin(): string {
  if (typeof window !== 'undefined' && window.location?.origin) return window.location.origin;
  return 'https://app.hyphaehub.io';
}

const shortCode = (id: string) => id.slice(-6).toUpperCase();

/** Build a label for a batch. QR opens the batch in the app. */
export function batchLabelData(batch: Batch, strainName?: string | null): LabelData {
  return {
    key: `batch:${batch.id}`,
    title: batch.name,
    subtitle: strainName ?? undefined,
    meta: `Batch · started ${formatDate(batch.startedAt)}`,
    url: `${appOrigin()}/batches/${batch.id}`,
    code: shortCode(batch.id),
  };
}

/** Build a label for a culture (source / grain jar / bulk tub). QR opens its batch. */
export function cultureLabelData(culture: Culture, strainName?: string | null): LabelData {
  const dateLabel =
    culture.type === 'BULK'
      ? culture.fruitingStartedAt
        ? `fruiting ${formatDate(culture.fruitingStartedAt)}`
        : 'tub'
      : culture.inoculatedAt
        ? `inoc ${formatDate(culture.inoculatedAt)}`
        : (culture.substrateType ?? '');
  const meta = [CULTURE_TYPE_LABELS[culture.type], dateLabel].filter(Boolean).join(' · ');
  return {
    key: `culture:${culture.id}`,
    title: culture.label,
    subtitle: strainName ?? undefined,
    meta,
    // Cultures live under a batch; deep-link to it (falls back to the app root).
    url: culture.batchId ? `${appOrigin()}/batches/${culture.batchId}` : `${appOrigin()}/`,
    code: shortCode(culture.id),
  };
}

/** Build a label for a harvest (flush). QR opens the parent batch. */
export function harvestLabelData(
  harvest: Harvest,
  batch?: Batch | null,
  strain?: string | null,
): LabelData {
  const dry = harvest.dryWeightG != null ? `${formatMass(harvest.dryWeightG)} dry` : 'drying…';
  const meta = [
    `${formatMass(harvest.wetWeightG)} wet`,
    dry,
    `harvested ${formatDate(harvest.harvestedAt)}`,
  ]
    .filter(Boolean)
    .join(' · ');
  const batchId = harvest.batchId ?? batch?.id ?? null;
  return {
    key: `harvest:${harvest.id}`,
    title: strain ? `${strain} · Flush ${harvest.flushNumber}` : `Flush ${harvest.flushNumber}`,
    subtitle: batch?.name ?? undefined,
    meta,
    url: batchId ? `${appOrigin()}/batches/${batchId}` : `${appOrigin()}/`,
    code: shortCode(harvest.id),
  };
}

/** Build a label for a strain. QR opens the strains catalog. */
export function strainLabelData(strain: Strain): LabelData {
  return {
    key: `strain:${strain.id}`,
    title: strain.commonName,
    subtitle: strain.species ?? undefined,
    meta: strain.category ? strain.category.toLowerCase() : undefined,
    url: `${appOrigin()}/strains`,
    code: shortCode(strain.id),
  };
}

/** Build a label for an inventory item. QR opens the inventory page. */
export function inventoryLabelData(item: InventoryItem): LabelData {
  const meta = [`${item.quantityOnHand} ${item.unit}`, item.supplier ?? '']
    .filter(Boolean)
    .join(' · ');
  return {
    key: `inventory:${item.id}`,
    title: item.name,
    subtitle: item.category ? item.category.toLowerCase() : undefined,
    meta,
    url: `${appOrigin()}/inventory`,
    code: shortCode(item.id),
  };
}

/** Resolve a strain name from a strain row (nullable). */
export function strainName(strain?: Strain | null): string | undefined {
  return strain?.commonName ?? undefined;
}

// ── Label preferences (remembered across sessions) ───────────────────────────

/** Which optional fields show on a label. Title + QR value are always present. */
export interface LabelFields {
  subtitle: boolean;
  meta: boolean;
  code: boolean;
  qr: boolean;
}

/** How labels lay out on paper. */
export type LabelLayout = 'page' | 'sheet';

export interface LabelPrefs {
  sizeKey: string;
  layout: LabelLayout;
  fields: LabelFields;
}

export const DEFAULT_LABEL_PREFS: LabelPrefs = {
  sizeKey: DEFAULT_LABEL_SIZE.key,
  layout: 'page',
  fields: { subtitle: true, meta: true, code: true, qr: true },
};

const PREFS_KEY = 'hh_label_prefs';

/** Read saved label prefs, merged over defaults. Safe if storage is unavailable. */
export function loadLabelPrefs(): LabelPrefs {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (!raw) return DEFAULT_LABEL_PREFS;
    const saved = JSON.parse(raw) as Partial<LabelPrefs>;
    return {
      sizeKey: saved.sizeKey ?? DEFAULT_LABEL_PREFS.sizeKey,
      layout: saved.layout === 'sheet' ? 'sheet' : 'page',
      fields: { ...DEFAULT_LABEL_PREFS.fields, ...(saved.fields ?? {}) },
    };
  } catch {
    return DEFAULT_LABEL_PREFS;
  }
}

/** Persist label prefs. No-op if storage is unavailable. */
export function saveLabelPrefs(prefs: LabelPrefs): void {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // ignore (private mode / storage disabled)
  }
}
