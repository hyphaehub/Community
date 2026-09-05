import type {
  BatchSummary,
  CultureStatus,
  CultureType,
  Plan,
  PlanLimits,
} from '@hyphaehub/core';
import * as SecureStore from 'expo-secure-store';

/** Configure via EXPO_PUBLIC_API_URL. Defaults to the hosted cloud API. */
export const API_URL =
  process.env.EXPO_PUBLIC_API_URL ?? 'https://hyphaehub-api.matt-pasley.workers.dev';

const TOKEN_KEY = 'hh_session_token';
let token: string | null = null;

export async function loadToken(): Promise<string | null> {
  token = await SecureStore.getItemAsync(TOKEN_KEY);
  return token;
}
export function getToken(): string | null {
  return token;
}
async function setToken(value: string | null): Promise<void> {
  token = value;
  if (value) await SecureStore.setItemAsync(TOKEN_KEY, value);
  else await SecureStore.deleteItemAsync(TOKEN_KEY);
}

// ── Shapes the app consumes ───────────────────────────────────────────────────
export interface Batch {
  id: string;
  name: string;
  status: string;
  strainId: string | null;
  startedAt: string | null;
}
export interface Culture {
  id: string;
  label: string;
  type: CultureType;
  status: CultureStatus;
  batchId: string | null;
  substrateType: string | null;
  colonizationPct: number | null;
}
export interface Strain {
  id: string;
  commonName: string;
  species: string | null;
  category: string;
  isPreset: boolean;
}
export interface Harvest {
  id: string;
  flushNumber: number;
  wetWeightG: number;
  dryWeightG: number | null;
}
export interface CostEntry {
  id: string;
  description: string;
  category: string;
  amountCents: number;
}
export interface BatchDetail {
  batch: Batch;
  strain: Strain | null;
  cultures: Culture[];
  harvests: Harvest[];
  costs: CostEntry[];
  summary: BatchSummary;
}
export interface Me {
  user: { id: string; email: string; name: string };
  workspace: { id: string; name: string };
  plan: Plan;
  limits: PlanLimits;
  usage: { activeBatches: number; cultures: number; photos: number };
}

// ── Forecast (server-computed; the app just renders it) ───────────────────────
export interface ForecastMilestone {
  stage: string;
  label: string;
  flushNumber?: number;
  predictedAt: string | null;
  baselineAt: string | null;
  actualAt: string | null;
  varianceDays: number | null;
  status: 'done' | 'overdue' | 'due' | 'upcoming' | 'stalled';
  expectedYieldG: number | null;
}
export interface BatchForecast {
  batchId?: string;
  batchName?: string;
  strainId?: string | null;
  anchorAt: string | null;
  ended: boolean;
  timeline: ForecastMilestone[];
  profile?: { samples?: number };
}
export interface CalendarMilestone extends ForecastMilestone {
  batchId?: string;
  batchName?: string;
}
export interface WeekBucket {
  weekStart: string;
  label: string;
  harvestCount: number;
  expectedYieldG: number | null;
  isGap: boolean;
}
export interface ForecastCalendar {
  from: string;
  to: string;
  milestones: CalendarMilestone[];
  weeks: WeekBucket[];
  gaps: string[];
  nextHarvest: { batchId?: string; batchName?: string; stage: string; date: string; expectedYieldG: number | null } | null;
  staggerHint: { gapWeekStart: string; inoculateBy: string; pipelineDays: number } | null;
  batches: { batchId?: string; batchName?: string; anchorAt: string | null; ended: boolean }[];
}

async function req<T>(path: string, opts: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = {
    // Native has no browser Origin; send our API origin (trusted by the server).
    Origin: API_URL,
    ...(opts.headers as Record<string, string>),
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (opts.body) headers['content-type'] = 'application/json';
  const res = await fetch(API_URL + path, { ...opts, headers });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) throw new Error(data?.error ?? `HTTP ${res.status}`);
  return data as T;
}
const post = (path: string, body: unknown) =>
  req(path, { method: 'POST', body: JSON.stringify(body) });

async function auth(path: string, body: unknown): Promise<void> {
  const res = await fetch(`${API_URL}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', Origin: API_URL },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error((await res.text()) || `HTTP ${res.status}`);
  const tok = res.headers.get('set-auth-token');
  if (tok) await setToken(tok);
}

export const signIn = (email: string, password: string) =>
  auth('/api/auth/sign-in/email', { email, password });
export const signUp = (name: string, email: string, password: string) =>
  auth('/api/auth/sign-up/email', { name, email, password });
export const signOut = () => setToken(null);

export const api = {
  me: () => req<Me>('/api/me'),
  strains: () => req<Strain[]>('/api/strains'),
  batches: () => req<Batch[]>('/api/batches'),
  batch: (id: string) => req<BatchDetail>(`/api/batches/${id}`),
  allCultures: () => req<Culture[]>('/api/cultures'),
  allHarvests: () => req<Harvest[]>('/api/harvests'),
  createBatch: (name: string, strainId?: string | null) =>
    post('/api/batches', { name, strainId: strainId ?? null }) as Promise<Batch>,
  cultures: (batchId: string) => req<Culture[]>(`/api/cultures?batchId=${batchId}`),
  createSource: (batchId: string, strainId: string | null, label: string, sourceType: string) =>
    post('/api/cultures', {
      type: 'SOURCE',
      label,
      batchId,
      strainId,
      sourceType,
      status: 'COLONIZED',
    }) as Promise<Culture>,
  split: (cultureId: string, batchId: string, count: number, labelPrefix: string, costCents?: number) =>
    post(`/api/cultures/${cultureId}/split`, {
      count,
      type: 'GRAIN',
      labelPrefix,
      status: 'COLONIZED',
      batchId,
      costPerChildCents: costCents,
    }),
  combine: (batchId: string, parentIds: string[], label: string, drySubstrateG?: number, costCents?: number) =>
    post('/api/cultures/combine', {
      parentIds,
      label,
      containerType: 'MONOTUB',
      batchId,
      drySubstrateG,
      substrateCostCents: costCents,
    }),
  logEvent: (cultureId: string, type: string, note?: string, data?: Record<string, unknown>) =>
    post('/api/events', { cultureId, type, note, data }),
  logHarvest: (cultureId: string, batchId: string, flushNumber: number, wetWeightG: number, dryWeightG?: number) =>
    post('/api/harvests', { cultureId, batchId, flushNumber, wetWeightG, dryWeightG }),
  forecastCalendar: () => req<ForecastCalendar>('/api/forecast/calendar'),
  forecastBatch: (id: string) => req<BatchForecast>(`/api/forecast/batch/${id}`),
};
