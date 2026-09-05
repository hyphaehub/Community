import {
  type BatchStatus,
  CULTURE_TYPE_LABELS,
  type CultureStatus,
  type CultureType,
  STATUS_LABELS,
} from '@hyphaehub/core';
import { Badge } from './ui';

type Color = 'neutral' | 'green' | 'amber' | 'red' | 'blue' | 'brown';

const cultureStatusColor: Record<CultureStatus, Color> = {
  PREPPING: 'neutral',
  INOCULATED: 'blue',
  COLONIZING: 'amber',
  COLONIZED: 'green',
  FRUITING: 'green',
  HARVESTING: 'brown',
  CONTAMINATED: 'red',
  SPENT: 'neutral',
  STORED: 'blue',
};

export function CultureStatusBadge({ status }: { status: CultureStatus }) {
  return <Badge color={cultureStatusColor[status]}>{STATUS_LABELS[status]}</Badge>;
}

const batchStatusColor: Record<BatchStatus, Color> = {
  ACTIVE: 'green',
  COMPLETED: 'blue',
  ABORTED: 'red',
  ARCHIVED: 'neutral',
};

export function BatchStatusBadge({ status }: { status: BatchStatus }) {
  return <Badge color={batchStatusColor[status]}>{status[0] + status.slice(1).toLowerCase()}</Badge>;
}

export function CultureTypeBadge({ type }: { type: CultureType }) {
  return <Badge color="brown">{CULTURE_TYPE_LABELS[type]}</Badge>;
}
