import { CULTURE_TYPE_LABELS } from '@hyphaehub/core';
import { formatDate } from './format';
import type { Batch, Culture, Strain } from './types';

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

/** Resolve a strain name from a strain row (nullable). */
export function strainName(strain?: Strain | null): string | undefined {
  return strain?.commonName ?? undefined;
}
