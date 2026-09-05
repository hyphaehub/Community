import { FEATURE_LIST, MEMBERSHIP_ROLES, PLAN_LIMITS, PLANS } from '@hyphaehub/core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Badge, Button, Card, Field, Input, PageHeader, SectionTitle, Spinner, Toggle } from '../components/ui';
import { api } from '../lib/api';
import { signOut } from '../lib/auth';
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
              <Input defaultValue={me.data.workspace.name} onChange={(e) => setName(e.target.value)} />
            </Field>
            <Button type="submit" variant="secondary" disabled={rename.isPending}>
              {rename.isPending ? 'Saving…' : 'Save'}
            </Button>
          </form>
        </Card>

        <Card>
          <SectionTitle
            action={<Badge color={me.data.plan === 'FREE' ? 'neutral' : 'green'}>{me.data.limits.label}</Badge>}
          >
            Usage
          </SectionTitle>
          <div className="space-y-4">
            <Meter label="Active batches" used={me.data.usage.activeBatches} limit={me.data.limits.maxActiveBatches} />
            <Meter label="Cultures" used={me.data.usage.cultures} limit={me.data.limits.maxCultures} />
            <Meter label="Photos" used={me.data.usage.photos} limit={me.data.limits.maxPhotos} />
          </div>
        </Card>
      </div>

      <div className="mt-8">
        <OrgManager me={me.data} />
      </div>

      <FeaturesSection me={me.data} />

      <ActivitySection me={me.data} />

      <div className="mt-8">
        <SectionTitle>Plans</SectionTitle>
        <div className="grid gap-4 md:grid-cols-3">
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
                  <li>{l.maxOrgs ?? 'Unlimited'} organization{l.maxOrgs === 1 ? '' : 's'}</li>
                  <li>{l.cloudSync ? 'Cloud sync' : 'No cloud sync'}</li>
                  <li>{l.analytics ? 'Analytics + export' : 'Basic tracking'}</li>
                  <li>{l.maxMembers} member{l.maxMembers > 1 ? 's' : ''}</li>
                </ul>
                {canBill && !current && p !== 'FREE' && (
                  <Button className="mt-4 w-full" onClick={() => upgrade(p)}>
                    Upgrade
                  </Button>
                )}
                {canBill && current && p !== 'FREE' && (
                  <Button
                    variant="secondary"
                    className="mt-4 w-full"
                    onClick={manageBilling}
                  >
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
          <label key={f.key} className="flex items-start justify-between gap-4">
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
          </label>
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
                  {o.id === activeId && <span className="ml-2 text-xs text-hyphae-700">· active</span>}
                </span>
                <Badge color={o.role === 'OWNER' ? 'green' : 'neutral'}>{o.role.toLowerCase()}</Badge>
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
              {createOrg.error instanceof Error ? createOrg.error.message : 'Could not create organization'}
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
                  {addMember.error instanceof Error ? addMember.error.message : 'Could not add member'}
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
