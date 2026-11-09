import { type FeatureDef, PLANS, PLAN_LIMITS } from '@hyphaehub/core';
import type { Plan } from '@hyphaehub/core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { Navigate } from 'react-router-dom';
import {
  Badge,
  Button,
  Card,
  Input,
  Modal,
  PageHeader,
  SectionTitle,
  Spinner,
  Toggle,
} from '../components/ui';
import { api } from '../lib/api';
import { downloadBlob } from '../lib/download';
import { formatDate, fromNow } from '../lib/format';
import type { AdminOrg, WaitlistSignup } from '../lib/types';

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <Card className="text-center">
      <div className="text-2xl font-bold text-substrate">{value.toLocaleString()}</div>
      <div className="text-xs uppercase tracking-wide text-ink/50">{label}</div>
    </Card>
  );
}

export function Admin() {
  const qc = useQueryClient();
  const me = useQuery({ queryKey: ['me'], queryFn: api.me });
  // Only fetch admin data once we know the caller is the platform super-admin.
  const admin = { enabled: me.data?.isSuperAdmin === true };
  const stats = useQuery({ queryKey: ['admin', 'stats'], queryFn: api.admin.stats, ...admin });
  const orgs = useQuery({ queryKey: ['admin', 'orgs'], queryFn: api.admin.workspaces, ...admin });
  const users = useQuery({ queryKey: ['admin', 'users'], queryFn: api.admin.users, ...admin });
  const feats = useQuery({
    queryKey: ['admin', 'features'],
    queryFn: api.admin.features,
    ...admin,
  });
  const auditLog = useQuery({
    queryKey: ['admin', 'audit'],
    queryFn: () => api.admin.audit(100),
    ...admin,
  });
  const waitlist = useQuery({
    queryKey: ['admin', 'waitlist'],
    queryFn: api.admin.waitlist,
    ...admin,
  });

  const [orgQuery, setOrgQuery] = useState('');
  const [userQuery, setUserQuery] = useState('');
  const [featureOrgId, setFeatureOrgId] = useState<string | null>(null);

  const setPlan = useMutation({
    mutationFn: ({ id, plan }: { id: string; plan: Plan }) => api.admin.setPlan(id, plan),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'orgs'] }),
  });
  const renameOrg = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) => api.orgs.rename(id, name),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'orgs'] }),
  });
  const setFeature = useMutation({
    mutationFn: (defaults: Record<string, boolean>) => api.admin.setFeatures(defaults),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'features'] }),
  });
  const invite = useMutation({
    mutationFn: (id: string) => api.admin.inviteWaitlist(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'waitlist'] }),
  });
  const removeSignup = useMutation({
    mutationFn: (id: string) => api.admin.removeWaitlist(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'waitlist'] }),
  });

  const links = useQuery({
    queryKey: ['admin', 'connect-links'],
    queryFn: api.admin.connectLinks,
    ...admin,
  });
  const verifyLink = useMutation({
    mutationFn: (id: string) => api.admin.verifyConnectLink(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'connect-links'] }),
  });
  const revokeLink = useMutation({
    mutationFn: (id: string) => api.admin.revokeConnectLink(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'connect-links'] }),
  });
  const selfHostInstalls = useQuery({
    queryKey: ['admin', 'installs'],
    queryFn: api.admin.installs,
    ...admin,
  });

  const s = stats.data;
  const mrr = useMemo(
    () =>
      s
        ? PLANS.reduce(
            (sum, p) => sum + (s.planDistribution[p] ?? 0) * (PLAN_LIMITS[p]?.priceMonthlyUsd ?? 0),
            0,
          )
        : 0,
    [s],
  );

  if (me.isLoading) return <Spinner />;
  if (me.isError || (me.data && !me.data.isSuperAdmin)) return <Navigate to="/" replace />;

  const orgRows = (orgs.data?.workspaces ?? []).filter((o) => {
    const q = orgQuery.trim().toLowerCase();
    return !q || o.name.toLowerCase().includes(q) || (o.ownerEmail ?? '').toLowerCase().includes(q);
  });
  const userRows = (users.data?.users ?? []).filter((u) => {
    const q = userQuery.trim().toLowerCase();
    return !q || u.email.toLowerCase().includes(q) || (u.name ?? '').toLowerCase().includes(q);
  });
  const featureCatalog = feats.data?.features ?? [];
  const featureOrg = orgRows.find((o) => o.id === featureOrgId) ?? null;

  return (
    <div>
      <PageHeader
        title="Platform Admin"
        subtitle="Manage organizations, users, features, and the early-access waitlist across HyphaeHub."
      />

      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Stat label="Users" value={s?.users ?? 0} />
        <Stat label="Orgs" value={s?.organizations ?? 0} />
        <Stat label="Batches" value={s?.batches ?? 0} />
        <Stat label="Cultures" value={s?.cultures ?? 0} />
        <Stat label="Harvests" value={s?.harvests ?? 0} />
        <Stat label="Photos" value={s?.photos ?? 0} />
      </div>

      <div className="mb-8 grid gap-3 sm:grid-cols-3">
        <Card>
          <div className="text-xs uppercase tracking-wide text-ink/50">Plan distribution</div>
          <div className="mt-2 flex flex-wrap gap-2">
            {PLANS.map((p) => (
              <Badge key={p} color={p === 'FREE' ? 'neutral' : 'brown'}>
                {p} · {s?.planDistribution[p] ?? 0}
              </Badge>
            ))}
          </div>
          <div className="mt-3 text-sm text-ink/60">
            Est. MRR <span className="font-semibold text-substrate">${mrr.toLocaleString()}</span> ·{' '}
            {s?.storefronts ?? 0} storefront{(s?.storefronts ?? 0) === 1 ? '' : 's'}
          </div>
        </Card>
        <Card className="text-center">
          <div className="text-2xl font-bold text-substrate">
            {(s?.waitlist ?? 0).toLocaleString()}
          </div>
          <div className="text-xs uppercase tracking-wide text-ink/50">Waitlist</div>
          <div className="mt-1 text-xs text-hyphae-700">
            +{s?.waitlistLast7d ?? 0} in last 7 days
          </div>
        </Card>
        <Card className="text-center">
          <div className="text-2xl font-bold text-substrate">{s?.storefronts ?? 0}</div>
          <div className="text-xs uppercase tracking-wide text-ink/50">Active storefronts</div>
        </Card>
      </div>

      <SectionTitle>Platform feature defaults</SectionTitle>
      <Card className="mb-8 space-y-4">
        <p className="text-xs text-ink/50">
          Defaults for organizations that haven't set their own override. Override a single org from
          its row below.
        </p>
        {featureCatalog.map((f) => {
          const on = feats.data?.defaults?.[f.key] ?? f.defaultEnabled;
          return (
            <div key={f.key} className="flex items-start justify-between gap-4">
              <span className="min-w-0">
                <span className="font-medium text-substrate">{f.label}</span>
                <span className="mt-0.5 block text-xs text-ink/60">{f.description}</span>
              </span>
              <Toggle
                checked={on}
                onChange={(v) => setFeature.mutate({ ...(feats.data?.defaults ?? {}), [f.key]: v })}
                disabled={setFeature.isPending}
                label={f.label}
              />
            </div>
          );
        })}
      </Card>

      <div className="mb-2 flex items-center justify-between gap-3">
        <SectionTitle>Organizations ({orgs.data?.total ?? 0})</SectionTitle>
        <Input
          value={orgQuery}
          onChange={(e) => setOrgQuery(e.target.value)}
          placeholder="Search name or owner…"
          className="w-56"
        />
      </div>
      <Card className="mb-8 overflow-x-auto p-0">
        <table className="w-full text-sm">
          <thead className="border-b border-mycelium text-left text-xs uppercase text-ink/50">
            <tr>
              <th className="px-4 py-3">Name</th>
              <th className="px-4 py-3">Owner</th>
              <th className="px-4 py-3">Plan</th>
              <th className="px-4 py-3">Store</th>
              <th className="px-4 py-3">Batches</th>
              <th className="px-4 py-3">Cultures</th>
              <th className="px-4 py-3">Created</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {orgRows.map((o) => (
              <tr key={o.id} className="border-b border-mycelium/60 last:border-0">
                <td className="px-4 py-3 font-medium text-substrate">{o.name}</td>
                <td className="px-4 py-3 text-ink/70">{o.ownerEmail ?? '—'}</td>
                <td className="px-4 py-3">
                  <select
                    value={o.plan}
                    onChange={(e) => setPlan.mutate({ id: o.id, plan: e.target.value as Plan })}
                    className="rounded-md border border-mycelium bg-white px-2 py-1 text-xs"
                  >
                    {PLANS.map((p) => (
                      <option key={p} value={p}>
                        {p}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="px-4 py-3">
                  {o.storefrontEnabled ? (
                    <Badge color="green">open</Badge>
                  ) : (
                    <span className="text-ink/30">—</span>
                  )}
                </td>
                <td className="px-4 py-3 text-ink/70">{o.batches}</td>
                <td className="px-4 py-3 text-ink/70">{o.cultures}</td>
                <td className="px-4 py-3 text-ink/50">{formatDate(o.createdAt)}</td>
                <td className="px-4 py-3">
                  <div className="flex items-center justify-end gap-3">
                    <button
                      type="button"
                      className="text-xs font-medium text-hyphae-700 hover:underline disabled:opacity-50"
                      onClick={() => {
                        const name = window.prompt('Rename organization', o.name)?.trim();
                        if (name && name !== o.name) renameOrg.mutate({ id: o.id, name });
                      }}
                      disabled={renameOrg.isPending}
                    >
                      Rename
                    </button>
                    <button
                      type="button"
                      className="text-xs font-medium text-hyphae-700 hover:underline"
                      onClick={() => setFeatureOrgId(o.id)}
                    >
                      Features
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {orgRows.length === 0 && (
              <tr>
                <td colSpan={8} className="px-4 py-6 text-center text-sm text-ink/50">
                  No organizations match.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </Card>

      <div className="mb-2 flex items-center justify-between gap-3">
        <SectionTitle>Early-access waitlist ({waitlist.data?.total ?? 0})</SectionTitle>
        {(waitlist.data?.signups.length ?? 0) > 0 && (
          <Button variant="secondary" onClick={() => exportCsv(waitlist.data?.signups ?? [])}>
            Export CSV
          </Button>
        )}
      </div>
      <Card className="mb-8 overflow-x-auto p-0">
        {waitlist.isLoading ? (
          <div className="p-4">
            <Spinner />
          </div>
        ) : (waitlist.data?.signups.length ?? 0) === 0 ? (
          <p className="p-4 text-sm text-ink/60">No signups yet.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="border-b border-mycelium text-left text-xs uppercase text-ink/50">
              <tr>
                <th className="px-4 py-3">Email</th>
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Source</th>
                <th className="px-4 py-3">Joined</th>
                <th className="px-4 py-3">Status</th>
              </tr>
            </thead>
            <tbody>
              {(waitlist.data?.signups ?? []).map((w) => (
                <tr key={w.id} className="border-b border-mycelium/60 last:border-0">
                  <td className="px-4 py-3 font-medium text-substrate">{w.email}</td>
                  <td className="px-4 py-3 text-ink/70">{w.name ?? '—'}</td>
                  <td className="px-4 py-3 text-ink/50">{w.source ?? '—'}</td>
                  <td className="px-4 py-3 text-ink/50">{fromNow(w.createdAt)}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      {w.status === 'INVITED' ? (
                        <Badge color="green">invited</Badge>
                      ) : (
                        <button
                          type="button"
                          className="text-xs font-medium text-hyphae-700 hover:underline disabled:opacity-50"
                          onClick={() => invite.mutate(w.id)}
                          disabled={invite.isPending}
                        >
                          Invite
                        </button>
                      )}
                      <button
                        type="button"
                        className="text-xs text-ink/40 hover:text-flush disabled:opacity-50"
                        onClick={() => {
                          if (window.confirm(`Remove ${w.email} from the waitlist?`))
                            removeSignup.mutate(w.id);
                        }}
                        disabled={removeSignup.isPending}
                      >
                        remove
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <div className="mb-2 flex items-center justify-between gap-3">
        <SectionTitle>Users ({users.data?.total ?? 0})</SectionTitle>
        <Input
          value={userQuery}
          onChange={(e) => setUserQuery(e.target.value)}
          placeholder="Search email or name…"
          className="w-56"
        />
      </div>
      <Card className="mb-8 overflow-x-auto p-0">
        <table className="w-full text-sm">
          <thead className="border-b border-mycelium text-left text-xs uppercase text-ink/50">
            <tr>
              <th className="px-4 py-3">Email</th>
              <th className="px-4 py-3">Name</th>
              <th className="px-4 py-3">Joined</th>
            </tr>
          </thead>
          <tbody>
            {userRows.map((u) => (
              <tr key={u.id} className="border-b border-mycelium/60 last:border-0">
                <td className="px-4 py-3 font-medium text-substrate">
                  {u.email}
                  {me.data && u.email === me.data.user.email && (
                    <span className="ml-2 inline-block align-middle">
                      <Badge color="green">you</Badge>
                    </span>
                  )}
                </td>
                <td className="px-4 py-3 text-ink/70">{u.name}</td>
                <td className="px-4 py-3 text-ink/50">{formatDate(u.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <SectionTitle>Self-host installs</SectionTitle>
      <Card className="mb-8">
        <p className="mb-3 text-xs text-ink/50">
          Anonymous pings from self-hosted Community instances (a random install id + version, no
          personal data). Instances opt out with <code>HYPHAEHUB_TELEMETRY=off</code>.
        </p>
        <div className="grid grid-cols-3 gap-3">
          <Stat label="Total installs" value={selfHostInstalls.data?.total ?? 0} />
          <Stat label="Active · 7d" value={selfHostInstalls.data?.active7 ?? 0} />
          <Stat label="Active · 30d" value={selfHostInstalls.data?.active30 ?? 0} />
        </div>
      </Card>

      <SectionTitle>Cloud Connect sessions</SectionTitle>
      <Card className="mb-8 overflow-x-auto p-0">
        <p className="px-4 pt-4 text-xs text-ink/50">
          Self-hosted instances that cloud users have connected to. Verify pings the server's
          <code className="mx-1">/health</code>; revoke forgets the link.
        </p>
        {(links.data?.links ?? []).length === 0 ? (
          <p className="p-4 text-sm text-ink/60">No self-hosted instances connected yet.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="border-b border-mycelium text-left text-xs uppercase text-ink/50">
              <tr>
                <th className="px-4 py-3">User</th>
                <th className="px-4 py-3">Server</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Last seen</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {(links.data?.links ?? []).map((l) => (
                <tr key={l.id} className="border-b border-mycelium/60 last:border-0">
                  <td className="px-4 py-3 text-ink/70">{l.userEmail ?? '—'}</td>
                  <td className="break-all px-4 py-3 font-medium text-substrate">{l.serverUrl}</td>
                  <td className="whitespace-nowrap px-4 py-3">
                    {l.lastStatus === 'ok' ? (
                      <Badge color="green">online</Badge>
                    ) : l.lastStatus === 'unreachable' ? (
                      <Badge color="red">unreachable</Badge>
                    ) : (
                      <span className="text-xs text-ink/40">unverified</span>
                    )}
                    {l.lastVerifiedAt && (
                      <span className="ml-2 text-xs text-ink/40">{fromNow(l.lastVerifiedAt)}</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-ink/50">{fromNow(l.lastSeenAt)}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-right">
                    <button
                      type="button"
                      className="text-hyphae-700 hover:underline disabled:opacity-50"
                      onClick={() => verifyLink.mutate(l.id)}
                      disabled={verifyLink.isPending}
                    >
                      Verify
                    </button>
                    <button
                      type="button"
                      className="ml-3 text-red-600 hover:underline disabled:opacity-50"
                      onClick={() => revokeLink.mutate(l.id)}
                      disabled={revokeLink.isPending}
                    >
                      Revoke
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <SectionTitle>Recent activity (platform-wide)</SectionTitle>
      <Card className="overflow-hidden p-0">
        {(auditLog.data ?? []).length === 0 ? (
          <p className="p-4 text-sm text-ink/60">No activity recorded yet.</p>
        ) : (
          (auditLog.data ?? []).map((e) => (
            <div
              key={e.id}
              className="flex items-center justify-between gap-3 border-b border-mycelium/60 px-4 py-2.5 text-sm last:border-0"
            >
              <span className="min-w-0 truncate text-substrate">{e.summary ?? e.action}</span>
              <span className="shrink-0 text-xs text-ink/50">
                {e.actorEmail ?? '—'}
                {e.workspaceName ? ` · ${e.workspaceName}` : ''} · {fromNow(e.createdAt)}
              </span>
            </div>
          ))
        )}
      </Card>

      {featureOrg && (
        <OrgFeaturesModal
          org={featureOrg}
          features={featureCatalog}
          onClose={() => setFeatureOrgId(null)}
        />
      )}
    </div>
  );
}

/** Per-org feature overrides: inherit (platform default) / on / off. */
function OrgFeaturesModal({
  org,
  features,
  onClose,
}: { org: AdminOrg; features: FeatureDef[]; onClose: () => void }) {
  const qc = useQueryClient();
  const set = useMutation({
    mutationFn: ({ key, enabled }: { key: string; enabled: boolean | null }) =>
      api.admin.setWorkspaceFeature(org.id, key, enabled),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'orgs'] }),
  });
  return (
    <Modal open onClose={onClose} title={`Features · ${org.name}`}>
      <p className="mb-3 text-xs text-ink/50">
        Override the platform default for this one organization. "Inherit" falls back to the
        default.
      </p>
      <div className="space-y-3">
        {features.map((f) => {
          const ov = org.features?.[f.key];
          const val = ov === undefined ? 'inherit' : ov ? 'on' : 'off';
          return (
            <div key={f.key} className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="text-sm font-medium text-substrate">{f.label}</div>
                <div className="truncate text-xs text-ink/50">{f.description}</div>
              </div>
              <select
                value={val}
                disabled={set.isPending}
                onChange={(e) => {
                  const v = e.target.value;
                  set.mutate({ key: f.key, enabled: v === 'inherit' ? null : v === 'on' });
                }}
                className="shrink-0 rounded-md border border-mycelium bg-white px-2 py-1 text-xs"
              >
                <option value="inherit">Inherit</option>
                <option value="on">On</option>
                <option value="off">Off</option>
              </select>
            </div>
          );
        })}
      </div>
      <div className="mt-4 flex justify-end">
        <Button variant="secondary" onClick={onClose}>
          Done
        </Button>
      </div>
    </Modal>
  );
}

function exportCsv(signups: WaitlistSignup[]) {
  const esc = (v: unknown) => {
    // Neutralize spreadsheet formula injection (=, +, -, @, tab, CR) by prefixing '.
    let str = String(v ?? '');
    if (/^[=+\-@\t\r]/.test(str)) str = `'${str}`;
    return `"${str.replace(/"/g, '""')}"`;
  };
  const header = 'email,name,source,status,joined\n';
  const body = signups
    .map((x) =>
      [x.email, x.name ?? '', x.source ?? '', x.status, new Date(x.createdAt).toISOString()]
        .map(esc)
        .join(','),
    )
    .join('\n');
  // Lead with a UTF-8 BOM so Excel reads non-ASCII names correctly.
  const blob = new Blob([`﻿${header}${body}`], { type: 'text/csv;charset=utf-8' });
  downloadBlob('hyphaehub-waitlist.csv', blob);
}
