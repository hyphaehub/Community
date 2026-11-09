import { LISTING_FORMS } from '@hyphaehub/core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  Input,
  PageHeader,
  Select,
  Spinner,
  Textarea,
  Toggle,
} from '../components/ui';
import { ApiError, api } from '../lib/api';
import { apiBase } from '../lib/connection';
import { formatDate, formatMass, money } from '../lib/format';

const FORM_LABELS: Record<string, string> = {
  FRESH: 'Fresh',
  DRIED: 'Dried',
  GROW_KIT: 'Grow kit',
  OTHER: 'Other',
};

export function Marketplace() {
  const me = useQuery({ queryKey: ['me'], queryFn: api.me });
  if (me.isLoading || !me.data) {
    return (
      <div>
        <PageHeader title="Storefront" subtitle="Let buyers see your inventory and call dibs." />
        <Spinner />
      </div>
    );
  }
  if (me.data.plan !== 'FARM') {
    return (
      <div>
        <PageHeader title="Storefront" subtitle="Let buyers see your inventory and call dibs." />
        <EmptyState
          title="Available on the Farm plan"
          hint="The buyer storefront — invite purchasers, list available product, share your harvest forecast, and manage reservation requests — is part of the Farm plan."
          action={
            <Button onClick={() => window.open('/pricing', '_blank')} variant="secondary">
              See plans
            </Button>
          }
        />
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Storefront"
        subtitle="Invite buyers, list what's available, and approve who calls dibs."
      />
      <div className="space-y-6">
        <SettingsCard />
        <DibsCard />
        {me.data.features.strainVoting && <VotesCard />}
        <ListingsCard />
        <BuyersCard />
      </div>
    </div>
  );
}

function SettingsCard() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['mkt-settings'], queryFn: api.marketplace.settings });
  const [blurb, setBlurb] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const save = useMutation({
    mutationFn: api.marketplace.updateSettings,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['mkt-settings'] }),
  });
  if (q.isLoading || !q.data)
    return (
      <Card>
        <Spinner />
      </Card>
    );
  const s = q.data;
  const blurbVal = blurb ?? s.blurb ?? '';
  // In Cloud Connect mode the farm's data lives on the self-host (apiBase()), not
  // the cloud bundle's origin — so the shareable portal link must target it.
  const storefrontUrl = `${apiBase() || window.location.origin}/portal`;
  const copyStorefront = () => {
    navigator.clipboard?.writeText(storefrontUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <Card>
      <h2 className="mb-3 text-lg font-semibold text-substrate">Storefront settings</h2>
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-4">
          <span>
            <span className="block text-sm font-medium text-substrate">Storefront enabled</span>
            <span className="block text-xs text-ink/50">
              Let invited buyers sign in and see availability.
            </span>
          </span>
          <Toggle
            label="Storefront enabled"
            checked={s.enabled}
            onChange={(v) => save.mutate({ enabled: v })}
          />
        </div>
        {s.enabled && (
          <div className="rounded-xl border border-hyphae-200 bg-hyphae-50 p-3">
            <div className="text-sm font-medium text-substrate">Your storefront link</div>
            <p className="mt-0.5 text-xs text-ink/50">
              Where buyers sign in. Invite buyers below to send each a private sign-in link to this
              page — or share this address so they know where to find you.
            </p>
            <div className="mt-2 flex items-center gap-2">
              <input
                readOnly
                value={storefrontUrl}
                onFocus={(e) => e.currentTarget.select()}
                className="w-full rounded-lg border border-mycelium bg-white px-3 py-2 text-xs text-ink"
              />
              <Button variant="secondary" onClick={copyStorefront}>
                {copied ? 'Copied' : 'Copy'}
              </Button>
              <a
                href={storefrontUrl}
                target="_blank"
                rel="noreferrer"
                className="whitespace-nowrap text-xs font-medium text-hyphae-700 hover:underline"
              >
                Open ↗
              </a>
            </div>
          </div>
        )}
        <div className="flex items-center justify-between gap-4">
          <span>
            <span className="block text-sm font-medium text-substrate">Show my forecast</span>
            <span className="block text-xs text-ink/50">
              Reveal predicted upcoming harvests so buyers can pre-order.
            </span>
          </span>
          <Toggle
            label="Show my forecast"
            checked={s.showForecast}
            onChange={(v) => save.mutate({ showForecast: v })}
          />
        </div>
        {s.showForecast && (
          <Field label="Forecast horizon (days)">
            <Input
              type="number"
              min={1}
              max={120}
              defaultValue={s.forecastDays}
              className="w-28"
              onBlur={(e) => {
                const n = Number(e.target.value);
                if (n >= 1 && n <= 120 && n !== s.forecastDays) save.mutate({ forecastDays: n });
              }}
            />
          </Field>
        )}
        <Field label="Storefront blurb (shown to buyers)">
          <Textarea
            rows={2}
            value={blurbVal}
            onChange={(e) => setBlurb(e.target.value)}
            placeholder="A short welcome — pickup details, order cutoffs, etc."
          />
          <div className="mt-2">
            <Button
              variant="secondary"
              onClick={() => save.mutate({ blurb: blurbVal })}
              disabled={save.isPending}
            >
              Save blurb
            </Button>
          </div>
        </Field>
      </div>
    </Card>
  );
}

function DibsCard() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['mkt-dibs'], queryFn: api.marketplace.dibs });
  const act = useMutation({
    mutationFn: ({ id, approve }: { id: string; approve: boolean }) =>
      approve ? api.marketplace.approveDib(id) : api.marketplace.declineDib(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['mkt-dibs'] }),
  });
  const rows = q.data ?? [];
  const pending = rows.filter((d) => d.status === 'PENDING');

  return (
    <Card>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-lg font-semibold text-substrate">Dibs requests</h2>
        {pending.length > 0 && <Badge color="amber">{pending.length} pending</Badge>}
      </div>
      {q.isLoading ? (
        <Spinner />
      ) : rows.length === 0 ? (
        <p className="text-sm text-ink/50">
          No requests yet. Invite buyers and list product to get started.
        </p>
      ) : (
        <div className="divide-y divide-mycelium">
          {rows.map((d) => (
            <div key={d.id} className="flex items-center justify-between gap-3 py-3">
              <div className="min-w-0">
                <div className="truncate text-sm font-medium text-substrate">
                  {d.buyer?.name || d.buyer?.email || 'Buyer'}
                  {' → '}
                  {d.listing?.title ?? 'Pre-order'}
                  {d.requestedQtyG ? ` · ${formatMass(d.requestedQtyG)}` : ''}
                </div>
                <div className="truncate text-xs text-ink/50">
                  {d.buyer?.email}
                  {d.note ? ` · "${d.note}"` : ''} · {formatDate(d.createdAt)}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {d.status === 'PENDING' ? (
                  <>
                    <Button
                      variant="secondary"
                      onClick={() => act.mutate({ id: d.id, approve: false })}
                    >
                      Decline
                    </Button>
                    <Button onClick={() => act.mutate({ id: d.id, approve: true })}>Approve</Button>
                  </>
                ) : (
                  <Badge
                    color={
                      d.status === 'APPROVED' || d.status === 'FULFILLED'
                        ? 'green'
                        : d.status === 'DECLINED'
                          ? 'red'
                          : 'neutral'
                    }
                  >
                    {d.status.toLowerCase()}
                  </Badge>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

function VotesCard() {
  const q = useQuery({ queryKey: ['mkt-votes'], queryFn: api.marketplace.votes });
  const tallies = q.data?.tallies ?? [];
  return (
    <Card>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-lg font-semibold text-substrate">Strain votes</h2>
        <span className="text-xs text-ink/50">what buyers want you to grow next</span>
      </div>
      {q.isLoading ? (
        <Spinner />
      ) : q.isError ? (
        <p className="text-sm text-flush">Couldn't load votes. Refresh to try again.</p>
      ) : tallies.length === 0 ? (
        <p className="text-sm text-ink/50">
          No votes yet. Buyers vote on strains you keep in your library — the more stock you store,
          the more there is to vote on.
        </p>
      ) : (
        <div className="divide-y divide-mycelium">
          {tallies.map((t, i) => (
            <div key={t.strainId} className="flex items-center justify-between gap-3 py-2.5">
              <div className="min-w-0 text-sm text-substrate">
                <span className="text-ink/40">{i + 1}.</span> {t.name}
              </div>
              <Badge color="brown">
                {t.votes} vote{t.votes === 1 ? '' : 's'}
              </Badge>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

function ListingsCard() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['mkt-listings'], queryFn: api.marketplace.listings });
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const create = useMutation({
    mutationFn: (b: Record<string, unknown>) => api.marketplace.createListing(b as never),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['mkt-listings'] });
      setOpen(false);
      setError(null);
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Could not create listing'),
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.marketplace.removeListing(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['mkt-listings'] }),
  });
  const toggle = useMutation({
    mutationFn: ({ id, status }: { id: string; status: 'AVAILABLE' | 'HIDDEN' }) =>
      api.marketplace.updateListing(id, { status }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['mkt-listings'] }),
  });
  const rows = q.data ?? [];

  return (
    <Card>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-lg font-semibold text-substrate">Listings</h2>
        <Button onClick={() => setOpen((v) => !v)} variant={open ? 'secondary' : 'primary'}>
          {open ? 'Close' : '+ List product'}
        </Button>
      </div>

      {open && (
        <form
          className="mb-4 grid gap-3 rounded-xl border border-mycelium bg-spore/40 p-4 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            const priceKg = f.get('price') ? Math.round(Number(f.get('price')) * 100) : null;
            const qtyKg = Number(f.get('qty') || 0);
            create.mutate({
              title: String(f.get('title')),
              form: String(f.get('form')),
              quantityG: qtyKg * 1000,
              pricePerKgCents: priceKg,
              availableAt: String(f.get('availableAt') || '') || null,
              notes: String(f.get('notes') || '') || null,
            });
          }}
        >
          <Field label="Title">
            <Input name="title" required placeholder="e.g. Blue Oyster" />
          </Field>
          <Field label="Form">
            <Select name="form" defaultValue="FRESH">
              {LISTING_FORMS.map((form) => (
                <option key={form} value={form}>
                  {FORM_LABELS[form] ?? form}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Quantity (kg)">
            <Input name="qty" type="number" step="0.1" min={0} required placeholder="e.g. 5" />
          </Field>
          <Field label="Price ($/kg, optional)">
            <Input name="price" type="number" step="0.01" min={0} placeholder="contact if blank" />
          </Field>
          <Field label="Ready date (optional)">
            <Input name="availableAt" type="date" />
          </Field>
          <Field label="Notes (optional)">
            <Input name="notes" placeholder="Grade, pickup, etc." />
          </Field>
          {error && <p className="text-sm text-red-600 sm:col-span-2">{error}</p>}
          <div className="sm:col-span-2">
            <Button type="submit" disabled={create.isPending}>
              {create.isPending ? 'Adding…' : 'Add listing'}
            </Button>
          </div>
        </form>
      )}

      {q.isLoading ? (
        <Spinner />
      ) : rows.length === 0 ? (
        <p className="text-sm text-ink/50">
          No listings yet. Add what you've harvested and have for sale.
        </p>
      ) : (
        <div className="divide-y divide-mycelium">
          {rows.map((l) => (
            <div key={l.id} className="flex items-center justify-between gap-3 py-3">
              <div className="min-w-0">
                <div className="truncate text-sm font-medium text-substrate">
                  {l.title} <span className="text-ink/40">· {FORM_LABELS[l.form] ?? l.form}</span>
                </div>
                <div className="truncate text-xs text-ink/50">
                  {formatMass(l.quantityG)} ·{' '}
                  {l.pricePerKgCents == null ? 'contact' : `${money(l.pricePerKgCents)}/kg`}
                  {l.availableAt ? ` · ready ${formatDate(l.availableAt)}` : ''}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <Badge color={l.status === 'AVAILABLE' ? 'green' : 'neutral'}>
                  {l.status.toLowerCase()}
                </Badge>
                <button
                  type="button"
                  className="text-xs text-ink/50 hover:text-hyphae-700"
                  onClick={() =>
                    toggle.mutate({
                      id: l.id,
                      status: l.status === 'AVAILABLE' ? 'HIDDEN' : 'AVAILABLE',
                    })
                  }
                >
                  {l.status === 'AVAILABLE' ? 'hide' : 'show'}
                </button>
                <button
                  type="button"
                  className="text-xs text-ink/40 hover:text-flush"
                  onClick={() => remove.mutate(l.id)}
                >
                  delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

function BuyersCard() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['mkt-buyers'], queryFn: api.marketplace.buyers });
  const [lastInvite, setLastInvite] = useState<{ url: string; emailed: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const invite = useMutation({
    mutationFn: (b: { email: string; name?: string | null }) => api.marketplace.invite(b),
    onSuccess: (res) => {
      setLastInvite({ url: res.inviteUrl, emailed: res.emailed });
      setError(null);
      qc.invalidateQueries({ queryKey: ['mkt-buyers'] });
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Could not invite'),
  });
  const reinvite = useMutation({
    mutationFn: (id: string) => api.marketplace.reinvite(id),
    onSuccess: (res) => setLastInvite({ url: res.inviteUrl, emailed: res.emailed }),
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.marketplace.removeBuyer(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['mkt-buyers'] }),
  });
  const rows = q.data ?? [];

  return (
    <Card>
      <h2 className="mb-3 text-lg font-semibold text-substrate">Buyers</h2>
      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          invite.mutate({
            email: String(f.get('email')),
            name: String(f.get('name') || '') || null,
          });
          e.currentTarget.reset();
        }}
      >
        <Field label="Email">
          <Input name="email" type="email" required placeholder="buyer@example.com" />
        </Field>
        <Field label="Name (optional)">
          <Input name="name" placeholder="Restaurant / person" />
        </Field>
        <Button type="submit" disabled={invite.isPending}>
          {invite.isPending ? 'Inviting…' : 'Invite buyer'}
        </Button>
      </form>
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}

      {lastInvite && (
        <div className="mt-3 rounded-xl border border-hyphae-200 bg-hyphae-50 p-3">
          <p className="text-sm text-substrate">
            {lastInvite.emailed
              ? 'Invite emailed. You can also share this link directly:'
              : 'Email is not configured — share this private sign-in link with the buyer:'}
          </p>
          <div className="mt-2 flex items-center gap-2">
            <input
              readOnly
              value={lastInvite.url}
              onFocus={(e) => e.currentTarget.select()}
              className="w-full rounded-lg border border-mycelium bg-white px-3 py-2 text-xs text-ink"
            />
            <Button
              variant="secondary"
              onClick={() => navigator.clipboard?.writeText(lastInvite.url)}
            >
              Copy
            </Button>
          </div>
        </div>
      )}

      <div className="mt-4 divide-y divide-mycelium">
        {rows.length === 0 ? (
          <p className="text-sm text-ink/50">No buyers yet. Invite your first purchaser above.</p>
        ) : (
          rows.map((b) => (
            <div key={b.id} className="flex items-center justify-between gap-3 py-2.5">
              <div className="min-w-0">
                <div className="truncate text-sm font-medium text-substrate">
                  {b.name || b.email}
                </div>
                <div className="truncate text-xs text-ink/50">{b.email}</div>
              </div>
              <div className="flex shrink-0 items-center gap-3">
                <Badge
                  color={
                    b.status === 'ACTIVE' ? 'green' : b.status === 'DISABLED' ? 'red' : 'neutral'
                  }
                >
                  {b.status.toLowerCase()}
                </Badge>
                <button
                  type="button"
                  className="text-xs text-ink/50 hover:text-hyphae-700"
                  onClick={() => reinvite.mutate(b.id)}
                >
                  resend link
                </button>
                <button
                  type="button"
                  className="text-xs text-ink/40 hover:text-flush"
                  onClick={() => remove.mutate(b.id)}
                >
                  remove
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </Card>
  );
}
