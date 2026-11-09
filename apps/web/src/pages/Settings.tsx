import { FEATURE_LIST, MEMBERSHIP_ROLES, PLANS, PLAN_LIMITS } from '@hyphaehub/core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Badge,
  Button,
  Card,
  Field,
  Input,
  PageHeader,
  SectionTitle,
  Spinner,
  Toggle,
} from '../components/ui';
import { type TransferFingerprint, type TransferImportResult, api } from '../lib/api';
import { signOut, useInstanceConfig } from '../lib/auth';
import { isConnectMode } from '../lib/connection';
import { downloadBlob } from '../lib/download';
import { fromNow } from '../lib/format';
import { setActiveOrg } from '../lib/org';
import type { Me } from '../lib/types';

function Meter({ label, used, limit }: { label: string; used: number; limit: number | null }) {
  const pct = limit == null ? 0 : Math.min(100, Math.round((used / limit) * 100));
  return (
    <div>
      <div className="mb-1 flex justify-between text-sm">
        <span className="text-ink/70">{label}</span>
        <span className="font-medium text-substrate">
          {used}
          {limit != null ? ` / ${limit}` : ' · unlimited'}
        </span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-mycelium">
        <div
          className={`h-full rounded-full ${pct >= 100 ? 'bg-flush' : 'bg-hyphae-500'}`}
          style={{ width: `${limit == null ? 8 : pct}%` }}
        />
      </div>
    </div>
  );
}

export function Settings() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const me = useQuery({ queryKey: ['me'], queryFn: api.me });
  const [name, setName] = useState('');
  const [billingMsg, setBillingMsg] = useState<string | null>(null);

  const rename = useMutation({
    mutationFn: (n: string) => api.updateWorkspace(n),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['me'] }),
  });

  async function upgrade(plan: string) {
    setBillingMsg(null);
    try {
      const d = await api.billing.checkout(plan);
      if (d.url) window.location.href = d.url;
      else setBillingMsg(d.error ?? 'Billing is not available right now.');
    } catch (e) {
      setBillingMsg(e instanceof Error ? e.message : 'Billing is not available right now.');
    }
  }

  async function manageBilling() {
    setBillingMsg(null);
    try {
      const d = await api.billing.portal();
      if (d.url) window.location.href = d.url;
      else setBillingMsg(d.error ?? 'Billing portal is not available.');
    } catch (e) {
      setBillingMsg(e instanceof Error ? e.message : 'Billing portal is not available.');
    }
  }

  if (me.isLoading || !me.data) return <Spinner />;

  const canBill = me.data.role === 'OWNER' || me.data.isSuperAdmin;

  return (
    <div>
      <PageHeader title="Settings" subtitle="Workspace, plan, and usage." />

      {me.data.isSuperAdmin && (
        <div className="mb-6 flex flex-wrap items-center gap-2 rounded-xl border border-hyphae-300 bg-hyphae-50 px-4 py-3 text-sm">
          <Badge color="green">Super admin</Badge>
          <span className="text-ink/70">
            {me.data.user.email} has full administrative access to this instance.
          </span>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <SectionTitle>Workspace</SectionTitle>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              rename.mutate(name || me.data.workspace.name);
            }}
            className="space-y-3"
          >
            <Field label="Name">
              <Input
                defaultValue={me.data.workspace.name}
                onChange={(e) => setName(e.target.value)}
              />
            </Field>
            <Button type="submit" variant="secondary" disabled={rename.isPending}>
              {rename.isPending ? 'Saving…' : 'Save'}
            </Button>
          </form>
        </Card>

        <Card>
          <SectionTitle
            action={
              <Badge color={me.data.plan === 'FREE' ? 'neutral' : 'green'}>
                {me.data.limits.label}
              </Badge>
            }
          >
            Usage
          </SectionTitle>
          <div className="space-y-4">
            <Meter
              label="Active batches"
              used={me.data.usage.activeBatches}
              limit={me.data.limits.maxActiveBatches}
            />
            <Meter
              label="Cultures"
              used={me.data.usage.cultures}
              limit={me.data.limits.maxCultures}
            />
            <Meter label="Photos" used={me.data.usage.photos} limit={me.data.limits.maxPhotos} />
          </div>
        </Card>
      </div>

      <div className="mt-8">
        <OrgManager me={me.data} />
      </div>

      <FeaturesSection me={me.data} />

      <ForecastTimesSection me={me.data} />

      <ActivitySection me={me.data} />

      <CloudConnectSection me={me.data} />

      <ConnectedServersSection />

      <DataTransferSection me={me.data} />

      <div className="mt-8">
        <SectionTitle>Plans</SectionTitle>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {PLANS.map((p) => {
            const l = PLAN_LIMITS[p];
            const current = me.data.plan === p;
            return (
              <Card key={p} className={current ? 'border-hyphae-400 ring-1 ring-hyphae-200' : ''}>
                <div className="flex items-center justify-between">
                  <h3 className="font-semibold text-substrate">{l.label}</h3>
                  {current && <Badge color="green">current</Badge>}
                </div>
                <div className="mt-1 text-2xl font-bold text-substrate">
                  ${l.priceMonthlyUsd}
                  <span className="text-sm font-normal text-ink/50">/mo</span>
                </div>
                <ul className="mt-3 space-y-1 text-sm text-ink/70">
                  <li>{l.maxActiveBatches ?? 'Unlimited'} active batches</li>
                  <li>{l.maxCultures ?? 'Unlimited'} cultures</li>
                  <li>
                    {l.maxOrgs ?? 'Unlimited'} organization{l.maxOrgs === 1 ? '' : 's'}
                  </li>
                  <li>{l.cloudSync ? 'Cloud sync' : 'No cloud sync'}</li>
                  <li>{l.analytics ? 'Analytics + export' : 'Basic tracking'}</li>
                  <li>
                    {l.maxMembers} member{l.maxMembers > 1 ? 's' : ''}
                  </li>
                  {l.selfHostConnect && <li>Official web + mobile apps on your own server</li>}
                </ul>
                {canBill && !current && p !== 'FREE' && (
                  <Button className="mt-4 w-full" onClick={() => upgrade(p)}>
                    Upgrade
                  </Button>
                )}
                {canBill && current && p !== 'FREE' && (
                  <Button variant="secondary" className="mt-4 w-full" onClick={manageBilling}>
                    Manage billing
                  </Button>
                )}
              </Card>
            );
          })}
        </div>
        {billingMsg && <p className="mt-3 text-sm text-flush">{billingMsg}</p>}
      </div>

      <div className="mt-10 border-t border-mycelium pt-6">
        <Button variant="secondary" onClick={() => signOut().then(() => navigate('/login'))}>
          Sign out
        </Button>
      </div>
    </div>
  );
}

/**
 * Self-host only: a "Connect to Cloud" handoff. Opens the cloud app with this
 * instance's origin prefilled; the operator confirms there (signed into the
 * cloud) and the link is recorded on the cloud. No cloud credential is stored
 * on this instance. Hidden on the cloud (edition !== 'community').
 */
function CloudConnectSection({ me }: { me: Me }) {
  const config = useInstanceConfig();
  const isOwnerAdmin = me.role === 'OWNER' || me.role === 'ADMIN' || me.isSuperAdmin;
  // Self-host only, and never on the cloud app pointed at a self-host (connect
  // mode routes /api/config to that self-host, which would falsely report
  // edition 'community' for the cloud bundle's own origin).
  if (config.data?.edition !== 'community' || !isOwnerAdmin || isConnectMode()) return null;

  const cloudUrl = config.data.cloudUrl || 'https://app.hyphaehub.io';
  const server = window.location.origin;
  const handoff = `${cloudUrl}/connect?server=${encodeURIComponent(server)}`;

  return (
    <div className="mt-8">
      <SectionTitle>HyphaeHub Cloud</SectionTitle>
      <Card className="space-y-3">
        <p className="text-sm text-ink/60">
          Link this self-hosted instance to your HyphaeHub Cloud account. You&rsquo;ll confirm while
          signed in to the cloud — then you can use the official cloud web &amp; mobile apps against
          this server (the &ldquo;My server&rdquo; sign-in), and it appears in your cloud account.
          Your data stays here; no cloud credential is stored on this server.
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <a href={handoff} target="_blank" rel="noreferrer">
            <Button>Connect to Cloud</Button>
          </a>
          <span className="text-xs text-ink/50">
            Opens {cloudUrl.replace(/^https?:\/\//, '')} to confirm.
          </span>
        </div>
        <p className="break-all text-xs text-ink/40">This server: {server}</p>
      </Card>
    </div>
  );
}

/**
 * Self-service list of the Cloud Connect links this signed-in user owns — the
 * self-hosts they've linked (via "Connect to Cloud" or the "My server" sign-in).
 * Previously only a super-admin could see or revoke these (Admin page); this lets
 * a user forget their own. Not edition-gated — any signed-in user may have links.
 * Renders nothing when there are no links (or the list can't be loaded).
 */
function ConnectedServersSection() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['connect-links'], queryFn: api.connect.list });
  const remove = useMutation({
    mutationFn: (id: string) => api.connect.remove(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['connect-links'] }),
  });

  const links = q.data ?? [];
  if (q.isError || links.length === 0) return null;

  return (
    <div className="mt-8">
      <SectionTitle>Connected servers</SectionTitle>
      <Card className="overflow-hidden p-0">
        {links.map((link) => (
          <div
            key={link.id}
            className="flex items-center justify-between gap-3 border-b border-mycelium/60 px-4 py-3 last:border-0"
          >
            <div className="min-w-0">
              <div className="truncate text-sm font-medium text-substrate">
                {link.label || link.serverUrl}
              </div>
              <div className="mt-0.5 truncate text-xs text-ink/50">
                {link.label ? `${link.serverUrl} · ` : ''}last seen {fromNow(link.lastSeenAt)}
              </div>
            </div>
            <Button
              variant="secondary"
              disabled={remove.isPending}
              onClick={() => {
                if (window.confirm(`Forget ${link.label || link.serverUrl}?`)) {
                  remove.mutate(link.id);
                }
              }}
            >
              Forget
            </Button>
          </div>
        ))}
      </Card>
    </div>
  );
}

function DataTransferSection({ me }: { me: Me }) {
  const isOwnerAdmin = me.role === 'OWNER' || me.role === 'ADMIN' || me.isSuperAdmin;
  const [busy, setBusy] = useState<null | 'export' | 'import' | 'verify'>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<TransferImportResult | null>(null);
  const [fp, setFp] = useState<TransferFingerprint | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const slug = (name: string) =>
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'workspace';

  async function doExport() {
    setError(null);
    setBusy('export');
    try {
      const archive = await api.transfer.exportArchive();
      const blob = new Blob([JSON.stringify(archive)], { type: 'application/json' });
      const name = `hyphaehub-${slug(archive.workspace?.name ?? 'workspace')}-${new Date().toISOString().slice(0, 10)}.json`;
      downloadBlob(name, blob);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Export failed.');
    } finally {
      setBusy(null);
    }
  }

  async function doImport(file: File) {
    setError(null);
    setResult(null);
    setBusy('import');
    try {
      const archive = JSON.parse(await file.text());
      setResult(await api.transfer.import(archive));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Import failed — is this a HyphaeHub export file?');
    } finally {
      setBusy(null);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  async function doVerify() {
    setError(null);
    setBusy('verify');
    try {
      setFp(await api.transfer.fingerprint());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not read the fingerprint.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="mt-8">
      <SectionTitle>Move your data (cloud ↔ self-host)</SectionTitle>
      <Card className="space-y-4">
        <p className="text-sm text-ink/60">
          Export this workspace to a portable file, then import it on another HyphaeHub — cloud or
          self-hosted, either direction. Import creates a <strong>new</strong> workspace and
          verifies it matches the source <strong>1:1</strong>; your current data is never changed.
        </p>

        {!isOwnerAdmin ? (
          <p className="text-sm text-ink/50">Only an owner or admin can export or verify data.</p>
        ) : (
          <>
            <div className="flex flex-wrap gap-3">
              <Button onClick={doExport} disabled={busy !== null}>
                {busy === 'export' ? 'Exporting…' : 'Export workspace'}
              </Button>
              <Button
                variant="secondary"
                onClick={() => fileRef.current?.click()}
                disabled={busy !== null}
              >
                {busy === 'import' ? 'Importing…' : 'Import from file'}
              </Button>
              <Button variant="secondary" onClick={doVerify} disabled={busy !== null}>
                {busy === 'verify' ? 'Reading…' : 'Verify current data'}
              </Button>
              <input
                ref={fileRef}
                type="file"
                accept="application/json,.json"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) doImport(f);
                }}
              />
            </div>

            {error && <p className="text-sm text-flush">{error}</p>}

            {result && (
              <div className="rounded-lg border border-mycelium bg-spore/50 p-3 text-sm">
                <div className="mb-1 flex items-center gap-2">
                  {result.verified ? (
                    <Badge color="green">1:1 verified</Badge>
                  ) : (
                    <Badge color="red">not verified</Badge>
                  )}
                  <span className="text-ink/70">
                    Imported into a new workspace (
                    {Object.values(result.counts).reduce((a, b) => a + b, 0)} rows).
                  </span>
                </div>
                {result.verified ? (
                  <p className="text-ink/60">
                    Every table, total, and the content hash match the source exactly.
                  </p>
                ) : result.mismatches.length ? (
                  <ul className="list-disc pl-5 text-flush">
                    {result.mismatches.map((m) => (
                      <li key={m}>{m}</li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-ink/50">
                    The source file had no fingerprint, so a 1:1 check wasn't possible.
                  </p>
                )}
              </div>
            )}

            {fp && (
              <div className="rounded-lg border border-mycelium bg-spore/50 p-3 text-xs text-ink/70">
                <p className="mb-1 font-medium text-substrate">This workspace's fingerprint</p>
                <p>
                  {Object.entries(fp.counts)
                    .map(([k, v]) => `${k}:${v}`)
                    .join('  ·  ')}
                </p>
                <p className="mt-1">
                  cost ${(fp.totals.costCents / 100).toFixed(2)} · wet {fp.totals.wetG}g · dry{' '}
                  {fp.totals.dryG}g · lineage {fp.totals.lineageEdges} edges
                </p>
                <p className="mt-1 break-all text-ink/40">hash {fp.hash.slice(0, 16)}…</p>
              </div>
            )}
          </>
        )}
      </Card>
    </div>
  );
}

function ActivitySection({ me }: { me: Me }) {
  const canView = me.role === 'OWNER' || me.role === 'ADMIN' || me.isSuperAdmin;
  const q = useQuery({ queryKey: ['audit'], queryFn: () => api.audit.list(50), enabled: canView });
  if (!canView) return null;
  return (
    <div className="mt-8">
      <SectionTitle>Recent activity</SectionTitle>
      <Card className="overflow-hidden p-0">
        {(q.data ?? []).length === 0 ? (
          <p className="p-4 text-sm text-ink/60">No activity recorded yet.</p>
        ) : (
          (q.data ?? []).map((e) => (
            <div
              key={e.id}
              className="flex items-center justify-between gap-3 border-b border-mycelium/60 px-4 py-2.5 text-sm last:border-0"
            >
              <span className="min-w-0 truncate text-substrate">{e.summary ?? e.action}</span>
              <span className="shrink-0 text-xs text-ink/50">
                {e.actorEmail ?? '—'} · {fromNow(e.createdAt)}
              </span>
            </div>
          ))
        )}
      </Card>
    </div>
  );
}

const FORECAST_FIELDS = [
  { key: 'colonization', label: 'Grain colonization', hint: 'Inoculation → spawn to bulk' },
  { key: 'bulkColonization', label: 'Bulk colonization', hint: 'Spawn → fruiting conditions' },
  { key: 'firstFlush', label: 'To first flush', hint: 'Fruiting → first harvest' },
  { key: 'flushGap', label: 'Between flushes', hint: 'Gap between consecutive flushes' },
] as const;

function ForecastTimesSection({ me }: { me: Me }) {
  const qc = useQueryClient();
  const canManage = me.role === 'OWNER' || me.role === 'ADMIN' || me.isSuperAdmin;
  const q = useQuery({
    queryKey: ['forecast-profile'],
    queryFn: api.forecast.profile,
    enabled: canManage,
  });
  const refreshForecasts = () =>
    qc.invalidateQueries({
      predicate: (query) => {
        const k = String(query.queryKey[0] ?? '');
        return k.startsWith('forecast') || k.startsWith('calendar') || k.startsWith('portal');
      },
    });
  const save = useMutation({ mutationFn: api.forecast.updateProfile, onSuccess: refreshForecasts });
  const learn = useMutation({ mutationFn: api.forecast.learnProfile, onSuccess: refreshForecasts });
  if (!canManage) return null;

  const p = q.data;
  return (
    <div className="mt-8">
      <SectionTitle
        action={
          p?.isCustom ? (
            <Badge color="green">customized</Badge>
          ) : (
            <Badge color="neutral">defaults</Badge>
          )
        }
      >
        Forecast base times
      </SectionTitle>
      <Card>
        <p className="mb-4 text-sm text-ink/60">
          The default stage lengths behind every batch's predicted timeline. Per-strain estimates
          (learned from your completed runs) still override these.
        </p>
        {p?.samples ? (
          <p className="-mt-2 mb-4 text-xs text-hyphae-700">
            Learned from {p.samples} completed run{p.samples === 1 ? '' : 's'}. The ± figures show
            how much each stage varies; predictions tighten as those shrink.
          </p>
        ) : null}
        <div className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-hyphae-200 bg-hyphae-50/60 px-4 py-3">
          <div className="flex-1">
            <div className="text-sm font-medium text-substrate">Learn from my history</div>
            <div className="text-xs text-ink/50">
              Set these base times from your own completed batches — data beats defaults.
            </div>
          </div>
          <Button variant="secondary" onClick={() => learn.mutate()} disabled={learn.isPending}>
            {learn.isPending ? 'Learning…' : 'Learn now'}
          </Button>
          {learn.data && (
            <p className="w-full text-xs text-hyphae-700">
              {learn.data.samples === 0
                ? 'Not enough completed-batch history yet — log a few runs through to harvest and try again.'
                : `Updated from ${learn.data.samples} run${learn.data.samples === 1 ? '' : 's'}.`}
            </p>
          )}
        </div>
        {!p ? (
          <Spinner />
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              save.mutate({
                colonization: Number(f.get('colonization')),
                bulkColonization: Number(f.get('bulkColonization')),
                firstFlush: Number(f.get('firstFlush')),
                flushGap: Number(f.get('flushGap')),
                flushes: Number(f.get('flushes')),
              });
            }}
          >
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {FORECAST_FIELDS.map((fld) => {
                const s = p.stats?.[fld.key];
                return (
                  <Field key={fld.key} label={`${fld.label} (days)`} hint={fld.hint}>
                    <Input
                      name={fld.key}
                      type="number"
                      min={1}
                      max={180}
                      defaultValue={p.durations[fld.key]}
                      required
                    />
                    {s && (
                      <div className="mt-1 text-[11px] text-ink/50">
                        ±{s.stdDevDays}d · {s.samples} run{s.samples === 1 ? '' : 's'}
                      </div>
                    )}
                  </Field>
                );
              })}
              <Field label="Flushes projected" hint="How many flushes to forecast">
                <Input
                  name="flushes"
                  type="number"
                  min={1}
                  max={8}
                  defaultValue={p.flushes}
                  required
                />
              </Field>
            </div>
            <div className="mt-4 flex items-center gap-3">
              <Button type="submit" disabled={save.isPending}>
                {save.isPending ? 'Saving…' : 'Save base times'}
              </Button>
              {p.defaults && (
                <button
                  type="button"
                  className="text-xs text-ink/50 hover:text-hyphae-700"
                  onClick={() =>
                    p.defaults &&
                    save.mutate({ ...p.defaults.durations, flushes: p.defaults.flushes })
                  }
                >
                  Reset to defaults
                </button>
              )}
              {save.isSuccess && <span className="text-xs text-hyphae-700">Saved.</span>}
            </div>
          </form>
        )}
      </Card>
    </div>
  );
}

function FeaturesSection({ me }: { me: Me }) {
  const qc = useQueryClient();
  const canManage = me.role === 'OWNER' || me.role === 'ADMIN' || me.isSuperAdmin;
  const toggle = useMutation({
    mutationFn: (v: { key: string; enabled: boolean }) =>
      api.orgs.setFeature(me.activeWorkspaceId, v.key, v.enabled),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['me'] }),
  });
  if (!canManage) return null;
  return (
    <div className="mt-8">
      <SectionTitle>Features</SectionTitle>
      <Card className="space-y-4">
        {FEATURE_LIST.map((f) => (
          <div key={f.key} className="flex items-start justify-between gap-4">
            <span className="min-w-0">
              <span className="font-medium text-substrate">{f.label}</span>
              <span className="mt-0.5 block text-xs text-ink/60">{f.description}</span>
            </span>
            <Toggle
              checked={!!me.features[f.key]}
              onChange={(v) => toggle.mutate({ key: f.key, enabled: v })}
              disabled={toggle.isPending}
              label={f.label}
            />
          </div>
        ))}
      </Card>
    </div>
  );
}

function OrgManager({ me }: { me: Me }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [orgName, setOrgName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<string>('MEMBER');
  const activeId = me.activeWorkspaceId;
  const canManage = me.role === 'OWNER' || me.role === 'ADMIN' || me.isSuperAdmin;

  const members = useQuery({
    queryKey: ['org-members', activeId],
    queryFn: () => api.orgs.members(activeId),
  });
  const createOrg = useMutation({
    mutationFn: (name: string) => api.orgs.create(name),
    onSuccess: (org) => {
      setOrgName('');
      setActiveOrg(org.id);
      qc.clear();
      navigate('/');
    },
  });
  const addMember = useMutation({
    mutationFn: () => api.orgs.addMember(activeId, email.trim(), role),
    onSuccess: () => {
      setEmail('');
      qc.invalidateQueries({ queryKey: ['org-members', activeId] });
    },
  });
  const changeRole = useMutation({
    mutationFn: (v: { userId: string; r: string }) => api.orgs.setRole(activeId, v.userId, v.r),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['org-members', activeId] }),
  });
  const removeMember = useMutation({
    mutationFn: (userId: string) => api.orgs.removeMember(activeId, userId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['org-members', activeId] });
      qc.invalidateQueries({ queryKey: ['me'] });
    },
  });

  return (
    <>
      <SectionTitle>Organizations</SectionTitle>
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <div className="mb-3 text-sm font-medium text-substrate">Your organizations</div>
          <ul className="space-y-2">
            {me.organizations.map((o) => (
              <li key={o.id} className="flex items-center justify-between text-sm">
                <span className="text-ink/80">
                  {o.name}
                  {o.id === activeId && (
                    <span className="ml-2 text-xs text-hyphae-700">· active</span>
                  )}
                </span>
                <Badge color={o.role === 'OWNER' ? 'green' : 'neutral'}>
                  {o.role.toLowerCase()}
                </Badge>
              </li>
            ))}
          </ul>
          <form
            className="mt-4 flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (orgName.trim()) createOrg.mutate(orgName.trim());
            }}
          >
            <Input
              placeholder="New organization name"
              value={orgName}
              onChange={(e) => setOrgName(e.target.value)}
            />
            <Button type="submit" variant="secondary" disabled={createOrg.isPending}>
              {createOrg.isPending ? '…' : 'Create'}
            </Button>
          </form>
          {createOrg.error && (
            <p className="mt-2 text-xs text-flush">
              {createOrg.error instanceof Error
                ? createOrg.error.message
                : 'Could not create organization'}
            </p>
          )}
        </Card>

        <Card>
          <div className="mb-3 text-sm font-medium text-substrate">
            Members of {me.workspace.name}
          </div>
          <ul className="space-y-2">
            {(members.data ?? []).map((m) => (
              <li key={m.userId} className="flex items-center justify-between gap-2 text-sm">
                <span className="min-w-0 flex-1 truncate text-ink/80">{m.email}</span>
                {canManage && m.userId !== me.user.id ? (
                  <>
                    <select
                      value={m.role}
                      onChange={(e) => changeRole.mutate({ userId: m.userId, r: e.target.value })}
                      className="rounded-md border border-mycelium bg-white px-2 py-1 text-xs"
                    >
                      {MEMBERSHIP_ROLES.map((rr) => (
                        <option key={rr} value={rr}>
                          {rr.toLowerCase()}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      onClick={() => removeMember.mutate(m.userId)}
                      className="text-xs text-flush hover:underline"
                    >
                      remove
                    </button>
                  </>
                ) : (
                  <Badge color="neutral">{m.role.toLowerCase()}</Badge>
                )}
              </li>
            ))}
          </ul>
          {canManage && (
            <form
              className="mt-4 space-y-2"
              onSubmit={(e) => {
                e.preventDefault();
                if (email.trim()) addMember.mutate();
              }}
            >
              <div className="flex gap-2">
                <Input
                  type="email"
                  placeholder="member@email.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
                <select
                  value={role}
                  onChange={(e) => setRole(e.target.value)}
                  className="rounded-md border border-mycelium bg-white px-2 text-sm"
                >
                  {MEMBERSHIP_ROLES.map((rr) => (
                    <option key={rr} value={rr}>
                      {rr.toLowerCase()}
                    </option>
                  ))}
                </select>
                <Button type="submit" variant="secondary" disabled={addMember.isPending}>
                  Add
                </Button>
              </div>
              {addMember.error && (
                <p className="text-xs text-flush">
                  {addMember.error instanceof Error
                    ? addMember.error.message
                    : 'Could not add member'}
                </p>
              )}
              <p className="text-xs text-ink/40">The person must have signed in once first.</p>
            </form>
          )}
        </Card>
      </div>
    </>
  );
}
