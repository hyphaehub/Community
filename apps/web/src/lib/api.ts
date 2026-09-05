import type {
  BatchCreateInput,
  BatchUpdateInput,
  CombineCulturesInput,
  CostEntryCreateInput,
  CultureCreateInput,
  CultureUpdateInput,
  EventCreateInput,
  HarvestCreateInput,
  HarvestUpdateInput,
  InventoryItemCreateInput,
  JarCreateInput,
  SplitCultureInput,
  StrainCreateInput,
} from '@hyphaehub/core';
import type {
  AdminAuditEntry,
  AdminOrg,
  AdminStats,
  AdminUser,
  AuditEntry,
  FeatureDef,
  Batch,
  BatchDetail,
  BatchForecastResponse,
  CalendarResponse,
  CostEntry,
  CostList,
  Culture,
  CultureDetail,
  Harvest,
  InventoryItem,
  LearnForecastResponse,
  Me,
  Member,
  OrgSummary,
  Strain,
  TimelineEvent,
} from './types';
import type { Plan } from '@hyphaehub/core';
import { getActiveOrg } from './org';

const BASE = import.meta.env.VITE_API_URL ?? '';

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

async function req<T>(path: string, opts: RequestInit = {}): Promise<T> {
  const headers = new Headers(opts.headers);
  if (opts.body && !headers.has('content-type')) headers.set('content-type', 'application/json');
  const active = getActiveOrg();
  if (active && !headers.has('x-workspace-id')) headers.set('x-workspace-id', active);
  const res = await fetch(BASE + path, { credentials: 'include', ...opts, headers });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) throw new ApiError(res.status, data?.error ?? res.statusText);
  return data as T;
}

const json = (body: unknown) => JSON.stringify(body);

export const api = {
  me: () => req<Me>('/api/me'),

  orgs: {
    list: () => req<OrgSummary[]>('/api/orgs'),
    create: (name: string) => req<OrgSummary>('/api/orgs', { method: 'POST', body: json({ name }) }),
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
    audit: (limit = 100) => req<AdminAuditEntry[]>(`/api/admin/audit?limit=${limit}`),
  },
  usage: () => req<{ usage: Me['usage']; limits: Me['limits']; plan: Me['plan'] }>('/api/usage'),
  updateWorkspace: (name: string) =>
    req('/api/workspace', { method: 'PATCH', body: json({ name }) }),

  strains: {
    list: () => req<Strain[]>('/api/strains'),
    create: (b: StrainCreateInput) => req<Strain>('/api/strains', { method: 'POST', body: json(b) }),
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
    list: (status?: string) =>
      req<Batch[]>(`/api/batches${status ? `?status=${status}` : ''}`),
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
  },

  events: {
    list: (cultureId?: string) =>
      req<TimelineEvent[]>(`/api/events${cultureId ? `?cultureId=${cultureId}` : ''}`),
    create: (b: EventCreateInput) =>
      req<TimelineEvent>('/api/events', { method: 'POST', body: json(b) }),
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
    remove: (id: string) => req(`/api/inventory/${id}`, { method: 'DELETE' }),
  },

  costs: {
    list: (batchId?: string) =>
      req<CostList>(`/api/costs${batchId ? `?batchId=${batchId}` : ''}`),
    create: (b: CostEntryCreateInput) =>
      req<CostEntry>('/api/costs', { method: 'POST', body: json(b) }),
    remove: (id: string) => req(`/api/costs/${id}`, { method: 'DELETE' }),
  },
};
