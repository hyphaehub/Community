import type {
  BatchForecast,
  BatchSummary,
  CalendarForecast,
  ForecastMilestone,
  ForecastProfile,
  ForecastReminder,
  MembershipRole,
  Plan,
  PlanLimits,
} from '@hyphaehub/core';
import type {
  Batch,
  Buyer,
  CostEntry,
  Culture,
  Dib,
  EnvironmentReading,
  Event as EventRow,
  Harvest,
  InventoryAdjustment,
  InventoryItem,
  Listing,
  LogEntry,
  Photo,
  Strain,
  Workspace,
} from '@hyphaehub/db';

export type {
  Batch,
  Buyer,
  CostEntry,
  Culture,
  Dib,
  EnvironmentReading,
  Harvest,
  InventoryAdjustment,
  InventoryItem,
  Listing,
  LogEntry,
  Photo,
  Strain,
  Workspace,
};

// ── Marketplace ────────────────────────────────────────────────────────────────
export interface StorefrontSettings {
  enabled: boolean;
  showForecast: boolean;
  forecastDays: number;
  blurb: string | null;
  name: string;
}
export interface DibWithRefs extends Dib {
  buyer: Buyer | null;
  listing: Listing | null;
}
export interface ListingAvailability extends Listing {
  reservedG: number;
  remainingG: number;
}
export interface PredictedItem {
  batchId: string;
  label: string;
  stage: string;
  predictedAt: string | null;
  expectedYieldG: number | null;
}
export interface StorefrontResponse {
  available: ListingAvailability[];
  predicted: PredictedItem[];
  showForecast: boolean;
}
export interface PortalMe {
  buyer: { id: string; workspaceId: string; email: string };
  farm: { name: string; blurb: string | null; showForecast: boolean; voting: boolean };
}
/** A strain a buyer can vote for (sourced from the farm's library), with live tally. */
export interface VoteCandidate {
  strainId: string;
  name: string;
  species: string | null;
  category: string;
  votes: number;
  voted: boolean;
}
/** Farm-side view of how buyers ranked each strain. */
export interface VoteTally {
  strainId: string;
  name: string;
  votes: number;
}
export interface PortalSession {
  sessionToken: string;
  buyer: { id: string; email: string; name: string | null };
  farm: { name: string; blurb: string | null };
}

// ── Genetics 2.0 ──────────────────────────────────────────────────────────────
export interface StrainPerformance {
  batches: number;
  cultures: number;
  contaminated: number;
  contamRate: number;
  totalWetG: number;
  totalDryG: number;
  biologicalEfficiency: number | null;
  maxGeneration: number;
}
export interface GenCulture extends Culture {
  generation: number;
}
export interface StrainOverview {
  strain: Strain;
  performance: StrainPerformance;
  cultures: GenCulture[];
  batches: { id: string; name: string; status: string; startedAt: string | number | null }[];
  library: Culture[];
}
export interface LibraryCulture extends Culture {
  reviveStatus: 'ok' | 'due' | 'overdue' | 'indefinite';
  reviveBy: string | null;
  strainName: string | null;
}
export interface StrainLeaderRow {
  strainId: string;
  name: string;
  cultures: number;
  contaminated: number;
  contamRate: number;
  totalWetG: number;
  totalDryG: number;
  biologicalEfficiency: number | null;
}

/** `GET/PATCH /api/forecast/profile` — workspace-level forecast base times. */
export interface ForecastDurations {
  colonization: number;
  bulkColonization: number;
  firstFlush: number;
  flushGap: number;
}
export interface ForecastBaseTimes {
  durations: ForecastDurations;
  flushes: number;
  isCustom: boolean;
  /** Learned per-stage spread (±days) and how many runs informed each. */
  stats?: Partial<Record<keyof ForecastDurations, { stdDevDays: number; samples: number }>> | null;
  /** How many completed runs the learned profile is based on. */
  samples?: number;
  defaults?: { durations: ForecastDurations; flushes: number };
}

/** `POST /api/ai/diagnose` — AI photo contamination diagnosis. */
export interface AiDiagnosis {
  healthy: boolean;
  /** A ContaminantType, or 'NONE' (healthy) / 'UNKNOWN'. */
  likelyContaminant: string;
  confidence: 'low' | 'medium' | 'high';
  summary: string;
  recommendation: string;
  model?: string;
}

/** `GET /api/reports/contamination` — contamination-rate analytics. */
export interface ContaminationBreakdown {
  key: string;
  label: string;
  total: number;
  contaminated: number;
  rate: number;
}
export interface ContaminationReport {
  overall: { total: number; contaminated: number; rate: number };
  byStage: ContaminationBreakdown[];
  byStrain: ContaminationBreakdown[];
  bySubstrate: ContaminationBreakdown[];
  byContaminant: { key: string; count: number }[];
  byCause: { key: string; count: number }[];
  recent: {
    id: string;
    label: string;
    type: string;
    batchId: string | null;
    contaminantType: string | null;
    contaminationCause: string | null;
    contaminatedAt: string | number | null;
  }[];
}
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
  photos: number;
  waitlist: number;
  waitlistLast7d: number;
  storefronts: number;
  planDistribution: Partial<Record<Plan, number>>;
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
  features: Record<string, boolean> | null;
  storefrontEnabled: boolean;
}

export interface WaitlistSignup {
  id: string;
  email: string;
  name: string | null;
  source: string | null;
  referrer: string | null;
  status: 'PENDING' | 'INVITED';
  createdAt: string | number;
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
export type {
  BatchForecast,
  ForecastMilestone,
  ForecastProfile,
  ForecastReminder,
  CalendarForecast,
};

/** `GET /api/forecast/reminders` — actionable upcoming life-stage transitions. */
export interface RemindersResponse {
  reminders: ForecastReminder[];
}

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
