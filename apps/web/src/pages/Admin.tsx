import { PLANS } from '@hyphaehub/core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Navigate } from 'react-router-dom';
import { Badge, Card, PageHeader, SectionTitle, Spinner, Toggle } from '../components/ui';
import { api } from '../lib/api';
import { formatDate, fromNow } from '../lib/format';
import type { Plan } from '@hyphaehub/core';

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <Card className="text-center">
      <div className="text-2xl font-bold text-substrate">{value}</div>
      <div className="text-xs uppercase tracking-wide text-ink/50">{label}</div>
    </Card>
  );
}

export function Admin() {
  const qc = useQueryClient();
  const me = useQuery({ queryKey: ['me'], queryFn: api.me });
  const stats = useQuery({ queryKey: ['admin', 'stats'], queryFn: api.admin.stats });
  const orgs = useQuery({ queryKey: ['admin', 'orgs'], queryFn: api.admin.workspaces });
  const users = useQuery({ queryKey: ['admin', 'users'], queryFn: api.admin.users });

  const feats = useQuery({ queryKey: ['admin', 'features'], queryFn: api.admin.features });
  const auditLog = useQuery({ queryKey: ['admin', 'audit'], queryFn: () => api.admin.audit(100) });

  const setPlan = useMutation({
    mutationFn: ({ id, plan }: { id: string; plan: Plan }) => api.admin.setPlan(id, plan),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'orgs'] }),
  });
  const setFeature = useMutation({
    mutationFn: (defaults: Record<string, boolean>) => api.admin.setFeatures(defaults),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'features'] }),
  });

  if (me.isLoading) return <Spinner />;
  if (me.data && !me.data.isSuperAdmin) return <Navigate to="/" replace />;

  return (
    <div>
      <PageHeader
        title="Platform Admin"
        subtitle="Manage organizations (cloud instances) and users across HyphaeHub."
      />

      <div className="mb-8 grid grid-cols-2 gap-3 sm:grid-cols-5">
        <Stat label="Users" value={stats.data?.users ?? 0} />
        <Stat label="Orgs" value={stats.data?.organizations ?? 0} />
        <Stat label="Batches" value={stats.data?.batches ?? 0} />
        <Stat label="Cultures" value={stats.data?.cultures ?? 0} />
        <Stat label="Harvests" value={stats.data?.harvests ?? 0} />
      </div>

      <SectionTitle>Feature defaults</SectionTitle>
      <Card className="mb-8 space-y-4">
        <p className="text-xs text-ink/50">
          Defaults for organizations that haven't set their own override.
        </p>
        {(feats.data?.features ?? []).map((f) => {
          const on = feats.data?.defaults?.[f.key] ?? f.defaultEnabled;
          return (
            <label key={f.key} className="flex items-start justify-between gap-4">
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
            </label>
          );
        })}
      </Card>

      <SectionTitle>Organizations</SectionTitle>
      <Card className="mb-8 overflow-x-auto p-0">
        <table className="w-full text-sm">
          <thead className="border-b border-mycelium text-left text-xs uppercase text-ink/50">
            <tr>
              <th className="px-4 py-3">Name</th>
              <th className="px-4 py-3">Owner</th>
              <th className="px-4 py-3">Plan</th>
              <th className="px-4 py-3">Batches</th>
              <th className="px-4 py-3">Cultures</th>
              <th className="px-4 py-3">Created</th>
            </tr>
          </thead>
          <tbody>
            {(orgs.data?.workspaces ?? []).map((o) => (
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
                <td className="px-4 py-3 text-ink/70">{o.batches}</td>
                <td className="px-4 py-3 text-ink/70">{o.cultures}</td>
                <td className="px-4 py-3 text-ink/50">{formatDate(o.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <SectionTitle>Users</SectionTitle>
      <Card className="overflow-x-auto p-0">
        <table className="w-full text-sm">
          <thead className="border-b border-mycelium text-left text-xs uppercase text-ink/50">
            <tr>
              <th className="px-4 py-3">Email</th>
              <th className="px-4 py-3">Name</th>
              <th className="px-4 py-3">Joined</th>
            </tr>
          </thead>
          <tbody>
            {(users.data?.users ?? []).map((u) => (
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
    </div>
  );
}
