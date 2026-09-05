import type {
  BatchForecast,
  BatchSummary,
  CalendarForecast,
  ForecastMilestone,
  ForecastProfile,
  MembershipRole,
  Plan,
  PlanLimits,
} from '@hyphaehub/core';
import type {
  Batch,
  CostEntry,
  Culture,
  Event as EventRow,
  Harvest,
  InventoryItem,
  Strain,
  Workspace,
} from '@hyphaehub/db';

export type { Batch, CostEntry, Culture, Harvest, InventoryItem, Strain, Workspace };
export type TimelineEvent = EventRow;

export interface Usage {
  activeBatches: number;
  cultures: number;
  photos: number;
}

export interface OrgSummary {
  id: string;
  name: string;
  plan: Plan;
  role: MembershipRole;
}

export interface Member {
  userId: string;
  email: string;
  name: string;
  role: MembershipRole;
  joinedAt: string | number;
}

export interface AdminStats {
  users: number;
  organizations: number;
  batches: number;
  cultures: number;
  harvests: number;
}

export interface AdminOrg {
  id: string;
  name: string;
  plan: Plan;
  createdAt: string | number;
  ownerEmail: string | null;
  ownerName: string | null;
  batches: number;
  cultures: number;
  harvests: number;
}

export interface AdminUser {
  id: string;
  email: string;
  name: string;
  createdAt: string | number;
}

export interface AuditEntry {
  id: string;
  action: string;
  entityType: string | null;
  entityId?: string | null;
  status: number | null;
  summary: string | null;
  createdAt: string | number;
  actorEmail: string | null;
  actorName?: string | null;
}

export interface AdminAuditEntry {
  id: string;
  action: string;
  entityType: string | null;
  status: number | null;
  summary: string | null;
  createdAt: string | number;
  actorEmail: string | null;
  workspaceName: string | null;
}

export interface Me {
  user: { id: string; email: string; name: string };
  workspace: Workspace;
  activeWorkspaceId: string;
  plan: Plan;
  limits: PlanLimits;
  usage: Usage;
  /** Effective feature flags for the active organization. */
  features: Record<string, boolean>;
  /** The user's role in the active organization. */
  role: MembershipRole;
  /** Platform super admin (orthogonal to org role). */
  isSuperAdmin: boolean;
  /** Every organization the user belongs to (for the switcher). */
  organizations: OrgSummary[];
}

export interface FeatureDef {
  key: string;
  label: string;
  description: string;
  defaultEnabled: boolean;
}

export interface BatchDetail {
  batch: Batch;
  strain: Strain | null;
  cultures: Culture[];
  harvests: Harvest[];
  costs: CostEntry[];
  summary: BatchSummary;
}

export interface CultureDetail {
  culture: Culture;
  events: TimelineEvent[];
  harvests: Harvest[];
  parents: Culture[];
  children: Culture[];
}

export interface CostList {
  entries: CostEntry[];
  totalCents: number;
  byCategory: Record<string, number>;
}

// ── Forecast ──────────────────────────────────────────────────────────────────
export type { BatchForecast, ForecastMilestone, ForecastProfile, CalendarForecast };

/** `GET /api/forecast/batch/:id` — one batch's timeline + the profile behind it. */
export interface BatchForecastResponse extends BatchForecast {
  profile: ForecastProfile;
}

/** `GET /api/forecast/calendar` — the aggregate production forecast. */
export interface CalendarResponse extends CalendarForecast {
  batches: {
    batchId?: string;
    batchName?: string;
    strainId?: string | null;
    anchorAt: string | null;
    ended: boolean;
  }[];
}

/** `POST /api/forecast/strains/:id/learn` result. */
export interface LearnForecastResponse {
  profile: ForecastProfile;
  samples: number;
  saved: boolean;
}
