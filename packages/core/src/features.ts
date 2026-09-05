/**
 * Feature-flag registry. Flags are resolved per organization: a workspace may
 * override a flag; otherwise the platform default (set by the super admin)
 * applies; otherwise the flag's built-in default is used.
 */
export interface FeatureDef {
  key: string;
  label: string;
  description: string;
  defaultEnabled: boolean;
}

export const FEATURES = {
  jars: {
    key: 'jars',
    label: 'Pre-batch jars',
    description:
      'Track sterilized grain jars before they are assigned to a batch. Creating jars draws grain down from inventory.',
    defaultEnabled: false,
  },
  hideDefaultStrains: {
    key: 'hideDefaultStrains',
    label: 'Hide preset strains',
    description:
      'Hide the built-in preset strain library for this organization; show only your own strains.',
    defaultEnabled: false,
  },
  forecast: {
    key: 'forecast',
    label: 'Cycle forecast & calendar',
    description:
      'Predict each batch stage on a calendar, compare estimated to actual, and forecast production output to keep a steady harvest.',
    defaultEnabled: true,
  },
  costs: {
    key: 'costs',
    label: 'Cost tracking',
    description:
      'Track materials, substrate, and supply costs per batch, with cost-per-gram and total spend. Turn off to hide all cost tracking.',
    defaultEnabled: true,
  },
} as const satisfies Record<string, FeatureDef>;

export type FeatureKey = keyof typeof FEATURES;
export const FEATURE_KEYS = Object.keys(FEATURES) as FeatureKey[];
export const FEATURE_LIST: FeatureDef[] = FEATURE_KEYS.map((k) => FEATURES[k]);

export type FeatureFlags = Record<FeatureKey, boolean>;

/**
 * Effective flags for an org: per-org override → platform default → built-in
 * default. Unknown keys in the stored maps are ignored.
 */
export function resolveFeatures(
  orgOverrides?: Partial<Record<string, boolean>> | null,
  platformDefaults?: Partial<Record<string, boolean>> | null,
): FeatureFlags {
  const out = {} as FeatureFlags;
  for (const key of FEATURE_KEYS) {
    const org = orgOverrides?.[key];
    if (typeof org === 'boolean') {
      out[key] = org;
      continue;
    }
    const plat = platformDefaults?.[key];
    if (typeof plat === 'boolean') {
      out[key] = plat;
      continue;
    }
    out[key] = FEATURES[key].defaultEnabled;
  }
  return out;
}

/** Whether a key is a known feature. */
export function isFeatureKey(key: string): key is FeatureKey {
  return Object.prototype.hasOwnProperty.call(FEATURES, key);
}
