import type {
  BatchCreateInput,
  BatchUpdateInput,
  BuyerInviteInput,
  CombineCulturesInput,
  ContaminationInput,
  CostEntryCreateInput,
  CostEntryUpdateInput,
  CultureCreateInput,
  CultureUpdateInput,
  EnvironmentReadingCreateInput,
  EventCreateInput,
  ForecastProfileSettingsInput,
  HarvestCreateInput,
  HarvestUpdateInput,
  InventoryItemCreateInput,
  InventoryItemUpdateInput,
  JarCreateInput,
  LibraryCreateInput,
  LibraryDrawInput,
  LibraryStoreInput,
  LibraryUpdateInput,
  ListingCreateInput,
  ListingUpdateInput,
  LogEntryCreateInput,
  LogEntryUpdateInput,
  SplitCultureInput,
  StorefrontSettingsInput,
  StrainCreateInput,
  StrainUpdateInput,
} from '@hyphaehub/core';
import type { Plan } from '@hyphaehub/core';
import { apiBase, bearerToken } from './connection';
import { getActiveOrg } from './org';
import type {
  AdminAuditEntry,
  AdminOrg,
  AdminStats,
  AdminUser,
  AiDiagnosis,
  AuditEntry,
  Batch,
  BatchDetail,
  BatchForecastResponse,
  Buyer,
  CalendarResponse,
  ContaminationReport,
  CostEntry,
  CostList,
  Culture,
  CultureDetail,
  DibWithRefs,
  EnvironmentReading,
  FeatureDef,
  ForecastBaseTimes,
  Harvest,
  InventoryAdjustment,
  InventoryItem,
  LearnForecastResponse,
  LibraryCulture,
  Listing,
  LogEntry,
  Me,
  Member,
  OrgSummary,
  Photo,
  RemindersResponse,
  StorefrontSettings,
  Strain,
  StrainLeaderRow,
  StrainOverview,
  TimelineEvent,
  VoteTally,
  WaitlistSignup,
} from './types';

const CLOUD_BASE = import.meta.env.VITE_API_URL ?? '';

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

/** A readable message from an error body — handles zod-validator's object shape. */
export function extractError(data: unknown, res: Response): string {
  const e = (data as { error?: unknown; message?: unknown } | null)?.error;
  if (typeof e === 'string') return e;
  const issues = (e as { issues?: { message?: string }[] } | undefined)?.issues;
  if (issues?.[0]?.message) return issues[0].message;
  const msg = (data as { message?: unknown } | null)?.message;
  if (typeof msg === 'string') return msg;
  return res.statusText || 'Request failed';
}

async function req<T>(path: string, opts: RequestInit = {}): Promise<T> {
  const headers = new Headers(opts.headers);
  // Only default to JSON for string bodies — let the browser set the multipart
  // boundary for FormData uploads (photos).
  if (typeof opts.body === 'string' && !headers.has('content-type')) {
    headers.set('content-type', 'application/json');
  }
  const active = getActiveOrg();
  if (active && !headers.has('x-workspace-id')) headers.set('x-workspace-id', active);
  // Connect mode: talk to the self-hosted server with bearer auth; cloud mode:
  // same-origin cookie auth.
  const base = apiBase() || CLOUD_BASE;
  const token = bearerToken();
  if (token && !headers.has('authorization')) headers.set('authorization', `Bearer ${token}`);
  const res = await fetch(base + path, { credentials: 'include', ...opts, headers });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) throw new ApiError(res.status, extractError(data, res));
  return data as T;
}

const json = (body: unknown) => JSON.stringify(body);

export interface ConnectLink {
  id: string;
  serverUrl: string;
  label: string | null;
  lastSeenAt: string;
  lastVerifiedAt: string | null;
  lastStatus: string | null;
  createdAt: string;
}
export interface AdminConnectLink extends ConnectLink {
  userEmail: string | null;
  userName: string | null;
}
export interface SelfHostInstall {
  id: string;
  installId: string;
  version: string | null;
  firstSeenAt: string;
  lastSeenAt: string;
  pingCount: number;
}
export interface TransferFingerprint {
  counts: Record<string, number>;
  totals: {
    costCents: number;
    wetG: number;
    dryG: number;
    drySubstrateG: number;
    photoBytes: number;
    lineageEdges: number;
  };
  tableHashes: Record<string, string>;
  hash: string;
}
export interface TransferImportResult {
  workspaceId: string;
  counts: Record<string, number>;
  verified: boolean;
  mismatches: string[];
  fingerprint: TransferFingerprint;
  sourceFingerprint: TransferFingerprint | null;
}

export const api = {
  me: () => req<Me>('/api/me'),

  /** Instance runtime config (login methods, photo support, edition, cloud URL). */
  config: () =>
    req<{
      auth0Enabled: boolean;
      emailPasswordEnabled: boolean;
      photosEnabled: boolean;
      edition: 'cloud' | 'community';
      cloudUrl: string;
    }>('/api/config'),

  orgs: {
    list: () => req<OrgSummary[]>('/api/orgs'),
    create: (name: string) =>
      req<OrgSummary>('/api/orgs', { method: 'POST', body: json({ name }) }),
    rename: (id: string, name: string) =>
      req(`/api/orgs/${id}`, { method: 'PATCH', body: json({ name }) }),
    members: (id: string) => req<Member[]>(`/api/orgs/${id}/members`),
    addMember: (id: string, email: string, role: string) =>
      req(`/api/orgs/${id}/members`, { method: 'POST', body: json({ email, role }) }),
    setRole: (id: string, userId: string, role: string) =>
      req(`/api/orgs/${id}/members/${userId}`, { method: 'PATCH', body: json({ role }) }),
    removeMember: (id: string, userId: string) =>
      req(`/api/orgs/${id}/members/${userId}`, { method: 'DELETE' }),
    setFeature: (id: string, key: string, enabled: boolean | null) =>
      req(`/api/orgs/${id}/features`, { method: 'PATCH', body: json({ key, enabled }) }),
  },

  audit: {
    list: (limit = 50) => req<AuditEntry[]>(`/api/audit?limit=${limit}`),
  },

  billing: {
    checkout: (plan: string) =>
      req<{ url?: string; error?: string }>('/api/billing/checkout', {
        method: 'POST',
        body: json({ plan }),
      }),
    portal: () => req<{ url?: string; error?: string }>('/api/billing/portal', { method: 'POST' }),
  },

  jars: {
    list: () => req<Culture[]>('/api/jars'),
    create: (b: JarCreateInput) => req('/api/jars', { method: 'POST', body: json(b) }),
    assign: (batchId: string, jarIds: string[]) =>
      req('/api/jars/assign', { method: 'POST', body: json({ batchId, jarIds }) }),
  },

  admin: {
    stats: () => req<AdminStats>('/api/admin/stats'),
    workspaces: () => req<{ workspaces: AdminOrg[]; total: number }>('/api/admin/workspaces'),
    users: () => req<{ users: AdminUser[]; total: number }>('/api/admin/users'),
    setPlan: (id: string, plan: Plan) =>
      req(`/api/admin/workspaces/${id}`, { method: 'PATCH', body: json({ plan }) }),
    features: () =>
      req<{ defaults: Record<string, boolean>; features: FeatureDef[] }>('/api/admin/features'),
    setFeatures: (defaults: Record<string, boolean>) =>
      req('/api/admin/features', { method: 'PATCH', body: json({ defaults }) }),
    setWorkspaceFeature: (id: string, key: string, enabled: boolean | null) =>
      req(`/api/admin/workspaces/${id}/features`, {
        method: 'PATCH',
        body: json({ key, enabled }),
      }),
    audit: (limit = 100) => req<AdminAuditEntry[]>(`/api/admin/audit?limit=${limit}`),
    connectLinks: () =>
      req<{ links: AdminConnectLink[]; total: number }>('/api/admin/connect-links'),
    verifyConnectLink: (id: string) =>
      req<{ reachable: boolean; status: string; latencyMs: number; detail: string | null }>(
        `/api/admin/connect-links/${id}/verify`,
        { method: 'POST' },
      ),
    revokeConnectLink: (id: string) => req(`/api/admin/connect-links/${id}`, { method: 'DELETE' }),
    waitlist: () => req<{ signups: WaitlistSignup[]; total: number }>('/api/admin/waitlist'),
    inviteWaitlist: (id: string) =>
      req<WaitlistSignup>(`/api/admin/waitlist/${id}/invite`, { method: 'POST' }),
    removeWaitlist: (id: string) => req(`/api/admin/waitlist/${id}`, { method: 'DELETE' }),
    installs: () =>
      req<{ installs: SelfHostInstall[]; total: number; active7: number; active30: number }>(
        '/api/admin/installs',
      ),
  },
  usage: () => req<{ usage: Me['usage']; limits: Me['limits']; plan: Me['plan'] }>('/api/usage'),
  updateWorkspace: (name: string) =>
    req('/api/workspace', { method: 'PATCH', body: json({ name }) }),

  strains: {
    list: () => req<Strain[]>('/api/strains'),
    overview: (id: string) => req<StrainOverview>(`/api/strains/${id}/overview`),
    create: (b: StrainCreateInput) =>
      req<Strain>('/api/strains', { method: 'POST', body: json(b) }),
    update: (id: string, b: StrainUpdateInput) =>
      req<Strain>(`/api/strains/${id}`, { method: 'PATCH', body: json(b) }),
    remove: (id: string) => req(`/api/strains/${id}`, { method: 'DELETE' }),
    categories: () =>
      req<{ builtin: string[]; custom: { id: string; name: string }[]; all: string[] }>(
        '/api/strains/categories',
      ),
    addCategory: (name: string) =>
      req<{ id: string; name: string }>('/api/strains/categories', {
        method: 'POST',
        body: json({ name }),
      }),
    removeCategory: (id: string) => req(`/api/strains/categories/${id}`, { method: 'DELETE' }),
  },

  batches: {
    list: (status?: string) => req<Batch[]>(`/api/batches${status ? `?status=${status}` : ''}`),
    get: (id: string) => req<BatchDetail>(`/api/batches/${id}`),
    create: (b: BatchCreateInput) => req<Batch>('/api/batches', { method: 'POST', body: json(b) }),
    update: (id: string, b: BatchUpdateInput) =>
      req<Batch>(`/api/batches/${id}`, { method: 'PATCH', body: json(b) }),
    remove: (id: string) => req(`/api/batches/${id}`, { method: 'DELETE' }),
  },

  cultures: {
    list: (params?: { batchId?: string; type?: string; status?: string }) => {
      const q = new URLSearchParams(params as Record<string, string>).toString();
      return req<Culture[]>(`/api/cultures${q ? `?${q}` : ''}`);
    },
    get: (id: string) => req<CultureDetail>(`/api/cultures/${id}`),
    create: (b: CultureCreateInput) =>
      req<Culture>('/api/cultures', { method: 'POST', body: json(b) }),
    update: (id: string, b: CultureUpdateInput) =>
      req<Culture>(`/api/cultures/${id}`, { method: 'PATCH', body: json(b) }),
    remove: (id: string) => req(`/api/cultures/${id}`, { method: 'DELETE' }),
    split: (id: string, b: SplitCultureInput) =>
      req<{ parent: Culture; children: Culture[] }>(`/api/cultures/${id}/split`, {
        method: 'POST',
        body: json(b),
      }),
    combine: (b: CombineCulturesInput) =>
      req<{ tub: Culture; parents: Culture[] }>('/api/cultures/combine', {
        method: 'POST',
        body: json(b),
      }),
    contaminate: (id: string, b: ContaminationInput) =>
      req<Culture>(`/api/cultures/${id}/contaminate`, { method: 'POST', body: json(b) }),
  },

  environment: {
    list: (batchId?: string) =>
      req<EnvironmentReading[]>(`/api/environment${batchId ? `?batchId=${batchId}` : ''}`),
    create: (b: EnvironmentReadingCreateInput) =>
      req<EnvironmentReading>('/api/environment', { method: 'POST', body: json(b) }),
    remove: (id: string) => req(`/api/environment/${id}`, { method: 'DELETE' }),
  },

  reports: {
    contamination: () => req<ContaminationReport>('/api/reports/contamination'),
    strains: () => req<{ strains: StrainLeaderRow[] }>('/api/reports/strains'),
  },

  library: {
    list: () => req<LibraryCulture[]>('/api/library'),
    create: (b: LibraryCreateInput) =>
      req<LibraryCulture>('/api/library', { method: 'POST', body: json(b) }),
    draw: (id: string, b: LibraryDrawInput) =>
      req<{
        source: Culture;
        batch: { id: string; name: string } | null;
        children: Culture[];
      }>(`/api/library/${id}/draw`, { method: 'POST', body: json(b) }),
    store: (cultureId: string, b: LibraryStoreInput) =>
      req<LibraryCulture>(`/api/library/${cultureId}/store`, { method: 'POST', body: json(b) }),
    update: (id: string, b: LibraryUpdateInput) =>
      req<LibraryCulture>(`/api/library/${id}`, { method: 'PATCH', body: json(b) }),
    revive: (id: string) => req<LibraryCulture>(`/api/library/${id}/revive`, { method: 'POST' }),
    remove: (id: string) => req(`/api/library/${id}`, { method: 'DELETE' }),
  },

  marketplace: {
    settings: () => req<StorefrontSettings>('/api/marketplace/settings'),
    updateSettings: (b: StorefrontSettingsInput) =>
      req<StorefrontSettings>('/api/marketplace/settings', { method: 'PATCH', body: json(b) }),
    buyers: () => req<Buyer[]>('/api/marketplace/buyers'),
    invite: (b: BuyerInviteInput) =>
      req<{ buyer: Buyer; inviteUrl: string; emailed: boolean }>('/api/marketplace/buyers', {
        method: 'POST',
        body: json(b),
      }),
    reinvite: (id: string) =>
      req<{ inviteUrl: string; emailed: boolean }>(`/api/marketplace/buyers/${id}/invite`, {
        method: 'POST',
      }),
    removeBuyer: (id: string) => req(`/api/marketplace/buyers/${id}`, { method: 'DELETE' }),
    listings: () => req<Listing[]>('/api/marketplace/listings'),
    createListing: (b: ListingCreateInput) =>
      req<Listing>('/api/marketplace/listings', { method: 'POST', body: json(b) }),
    updateListing: (id: string, b: ListingUpdateInput) =>
      req<Listing>(`/api/marketplace/listings/${id}`, { method: 'PATCH', body: json(b) }),
    removeListing: (id: string) => req(`/api/marketplace/listings/${id}`, { method: 'DELETE' }),
    dibs: () => req<DibWithRefs[]>('/api/marketplace/dibs'),
    approveDib: (id: string) => req(`/api/marketplace/dibs/${id}/approve`, { method: 'POST' }),
    declineDib: (id: string) => req(`/api/marketplace/dibs/${id}/decline`, { method: 'POST' }),
    votes: () => req<{ tallies: VoteTally[] }>('/api/marketplace/votes'),
  },

  ai: {
    /** Diagnose an uploaded image (multipart). */
    diagnose: (file: File) => {
      const form = new FormData();
      form.append('file', file);
      return req<AiDiagnosis>('/api/ai/diagnose', { method: 'POST', body: form });
    },
    /** Diagnose an already-stored photo by id. */
    diagnosePhoto: (photoId: string) =>
      req<AiDiagnosis>('/api/ai/diagnose', { method: 'POST', body: json({ photoId }) }),
  },

  events: {
    list: (cultureId?: string) =>
      req<TimelineEvent[]>(`/api/events${cultureId ? `?cultureId=${cultureId}` : ''}`),
    create: (b: EventCreateInput) =>
      req<TimelineEvent>('/api/events', { method: 'POST', body: json(b) }),
    remove: (id: string) => req(`/api/events/${id}`, { method: 'DELETE' }),
  },

  forecast: {
    batch: (id: string) => req<BatchForecastResponse>(`/api/forecast/batch/${id}`),
    calendar: (from?: string, to?: string) => {
      const q = new URLSearchParams();
      if (from) q.set('from', from);
      if (to) q.set('to', to);
      const qs = q.toString();
      return req<CalendarResponse>(`/api/forecast/calendar${qs ? `?${qs}` : ''}`);
    },
    learnStrain: (strainId: string) =>
      req<LearnForecastResponse>(`/api/forecast/strains/${strainId}/learn`, { method: 'POST' }),
    profile: () => req<ForecastBaseTimes>('/api/forecast/profile'),
    updateProfile: (b: ForecastProfileSettingsInput) =>
      req<ForecastBaseTimes>('/api/forecast/profile', { method: 'PATCH', body: json(b) }),
    learnProfile: () =>
      req<ForecastBaseTimes & { samples: number; saved: boolean }>('/api/forecast/profile/learn', {
        method: 'POST',
      }),
    reminders: (horizonDays?: number) =>
      req<RemindersResponse>(
        `/api/forecast/reminders${horizonDays ? `?horizonDays=${horizonDays}` : ''}`,
      ),
    /** Mint (or return) the workspace's subscription token → { path }. */
    subscription: () => req<{ path: string }>('/api/forecast/subscription', { method: 'POST' }),
    /** Rotate the subscription token (old links stop working) → { path }. */
    rotateSubscription: () =>
      req<{ path: string }>('/api/forecast/subscription/rotate', { method: 'POST' }),
    /** Fetch the .ics calendar feed as text (respects the active org + connect mode). */
    calendarIcs: () => {
      const headers = new Headers();
      const active = getActiveOrg();
      if (active) headers.set('x-workspace-id', active);
      const token = bearerToken();
      if (token) headers.set('authorization', `Bearer ${token}`);
      const base = apiBase() || CLOUD_BASE;
      return fetch(`${base}/api/forecast/calendar.ics`, { credentials: 'include', headers }).then(
        (r) => {
          if (!r.ok) throw new ApiError(r.status, 'Could not build the calendar file.');
          return r.text();
        },
      );
    },
  },

  harvests: {
    list: (params?: { batchId?: string; cultureId?: string }) => {
      const q = new URLSearchParams(params as Record<string, string>).toString();
      return req<Harvest[]>(`/api/harvests${q ? `?${q}` : ''}`);
    },
    create: (b: HarvestCreateInput) =>
      req<Harvest>('/api/harvests', { method: 'POST', body: json(b) }),
    update: (id: string, b: HarvestUpdateInput) =>
      req<Harvest>(`/api/harvests/${id}`, { method: 'PATCH', body: json(b) }),
    remove: (id: string) => req(`/api/harvests/${id}`, { method: 'DELETE' }),
  },

  inventory: {
    list: () => req<InventoryItem[]>('/api/inventory'),
    create: (b: InventoryItemCreateInput) =>
      req<InventoryItem>('/api/inventory', { method: 'POST', body: json(b) }),
    update: (id: string, b: InventoryItemUpdateInput) =>
      req<InventoryItem>(`/api/inventory/${id}`, { method: 'PATCH', body: json(b) }),
    adjust: (
      id: string,
      delta: number,
      opts?: { kind?: string; reason?: string | null; note?: string | null },
    ) =>
      req<InventoryItem>(`/api/inventory/${id}/adjust`, {
        method: 'POST',
        body: json({ delta, ...opts }),
      }),
    adjustments: (id: string) => req<InventoryAdjustment[]>(`/api/inventory/${id}/adjustments`),
    remove: (id: string) => req(`/api/inventory/${id}`, { method: 'DELETE' }),
  },

  costs: {
    list: (batchId?: string) => req<CostList>(`/api/costs${batchId ? `?batchId=${batchId}` : ''}`),
    create: (b: CostEntryCreateInput) =>
      req<CostEntry>('/api/costs', { method: 'POST', body: json(b) }),
    update: (id: string, b: CostEntryUpdateInput) =>
      req<CostEntry>(`/api/costs/${id}`, { method: 'PATCH', body: json(b) }),
    remove: (id: string) => req(`/api/costs/${id}`, { method: 'DELETE' }),
  },

  logs: {
    list: (batchId?: string) => req<LogEntry[]>(`/api/logs${batchId ? `?batchId=${batchId}` : ''}`),
    create: (b: LogEntryCreateInput) =>
      req<LogEntry>('/api/logs', { method: 'POST', body: json(b) }),
    update: (id: string, b: LogEntryUpdateInput) =>
      req<LogEntry>(`/api/logs/${id}`, { method: 'PATCH', body: json(b) }),
    remove: (id: string) => req(`/api/logs/${id}`, { method: 'DELETE' }),
  },

  photos: {
    list: (params?: { cultureId?: string; logEntryId?: string }) => {
      const q = new URLSearchParams(params as Record<string, string>).toString();
      return req<Photo[]>(`/api/photos${q ? `?${q}` : ''}`);
    },
    /**
     * Fetch a photo's bytes with auth headers → Blob. An `<img src>` can't carry
     * the bearer token in connect mode, so we load the bytes ourselves. The Blob
     * is safe to cache; the caller mints (and revokes) an object URL per mount.
     */
    blob: async (id: string) => {
      const headers = new Headers();
      const active = getActiveOrg();
      if (active) headers.set('x-workspace-id', active);
      const token = bearerToken();
      if (token) headers.set('authorization', `Bearer ${token}`);
      const base = apiBase() || CLOUD_BASE;
      const res = await fetch(`${base}/api/photos/${id}/raw`, { credentials: 'include', headers });
      if (!res.ok) throw new ApiError(res.status, 'Could not load photo');
      return res.blob();
    },
    /** Upload a photo via multipart; links it to a log entry / culture / etc. */
    upload: (file: File, links: { logEntryId?: string; cultureId?: string; caption?: string }) => {
      const form = new FormData();
      form.append('file', file);
      if (links.logEntryId) form.append('logEntryId', links.logEntryId);
      if (links.cultureId) form.append('cultureId', links.cultureId);
      if (links.caption) form.append('caption', links.caption);
      return req<Photo>('/api/photos', { method: 'POST', body: form });
    },
    remove: (id: string) => req(`/api/photos/${id}`, { method: 'DELETE' }),
  },

  // Move a workspace between the cloud and a self-hosted instance (either way).
  transfer: {
    /** The active workspace as a portable export archive (owner/admin only). */
    exportArchive: () =>
      req<{ hyphaehub: unknown; workspace: { name: string } }>('/api/transfer/export'),
    /** Import an archive into a NEW workspace; verifies it 1:1 against the archive. */
    import: (archive: unknown) =>
      req<TransferImportResult>('/api/transfer/import', { method: 'POST', body: json(archive) }),
    /** The active workspace's current fingerprint (owner/admin). */
    fingerprint: () => req<TransferFingerprint>('/api/transfer/fingerprint'),
  },

  // Cloud Connect link registry (which self-hosts a user is connected to).
  connect: {
    /** Register/refresh this user's link to their self-host, recorded on the
     *  CLOUD backend (needs a cloud session; silently no-ops otherwise). */
    register: (serverUrl: string, label?: string) =>
      fetch(`${CLOUD_BASE}/api/connect`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ serverUrl, label }),
      }).then((r) => (r.ok ? r.json() : null)),
    list: () => req<ConnectLink[]>('/api/connect'),
    remove: (id: string) => req(`/api/connect/${id}`, { method: 'DELETE' }),
  },
};
