import type { Plan } from './enums';

/** Capabilities and quotas for a plan. `null` means unlimited. */
export interface PlanLimits {
  label: string;
  priceMonthlyUsd: number;
  /** Max batches in ACTIVE status at once. */
  maxActiveBatches: number | null;
  /** Max total culture records. */
  maxCultures: number | null;
  /** Max stored photos. */
  maxPhotos: number | null;
  /** Max members in the workspace. */
  maxMembers: number;
  /** Max organizations (farms) a user on this plan may own. */
  maxOrgs: number | null;
  /** Cloud sync of a self-hosted instance. */
  cloudSync: boolean;
  /** Analytics dashboards + CSV/PDF export. */
  analytics: boolean;
}

export const PLAN_LIMITS: Record<Plan, PlanLimits> = {
  FREE: {
    label: 'Free',
    priceMonthlyUsd: 0,
    maxActiveBatches: 3,
    maxCultures: 50,
    maxPhotos: 50,
    maxMembers: 1,
    maxOrgs: 1,
    cloudSync: false,
    analytics: false,
  },
  PRO: {
    label: 'Pro',
    priceMonthlyUsd: 9,
    maxActiveBatches: null,
    maxCultures: null,
    maxPhotos: 5000,
    maxMembers: 1,
    maxOrgs: 3,
    cloudSync: true,
    analytics: true,
  },
  FARM: {
    label: 'Farm',
    priceMonthlyUsd: 29,
    maxActiveBatches: null,
    maxCultures: null,
    maxPhotos: null,
    maxMembers: 10,
    maxOrgs: null,
    cloudSync: true,
    analytics: true,
  },
};

export interface LimitCheck {
  allowed: boolean;
  limit: number | null;
  current: number;
  plan: Plan;
  message?: string;
}

/**
 * Check whether adding one more of a quota-limited resource is allowed.
 * `null` limits are always allowed (unlimited).
 */
export function checkLimit(
  plan: Plan,
  key: 'maxActiveBatches' | 'maxCultures' | 'maxPhotos' | 'maxMembers' | 'maxOrgs',
  current: number,
): LimitCheck {
  const limit = PLAN_LIMITS[plan][key];
  const allowed = limit === null || current < limit;
  return {
    allowed,
    limit,
    current,
    plan,
    message: allowed
      ? undefined
      : `Your ${PLAN_LIMITS[plan].label} plan allows ${limit} ${labelFor(key)}. Upgrade to add more.`,
  };
}

function labelFor(key: string): string {
  switch (key) {
    case 'maxActiveBatches':
      return 'active batches';
    case 'maxCultures':
      return 'cultures';
    case 'maxPhotos':
      return 'photos';
    case 'maxMembers':
      return 'members';
    case 'maxOrgs':
      return 'organizations';
    default:
      return 'items';
  }
}
