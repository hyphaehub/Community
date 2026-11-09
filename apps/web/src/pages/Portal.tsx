import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { LogoMark } from '../components/Logo';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  Input,
  Modal,
  Spinner,
  Textarea,
} from '../components/ui';
import { ApiError } from '../lib/api';
import { formatDate, formatMass, money } from '../lib/format';
import { getBuyerToken, portalApi, setBuyerToken } from '../lib/portal';
import type { ListingAvailability, PredictedItem, VoteCandidate } from '../lib/types';

const FORM_LABELS: Record<string, string> = {
  FRESH: 'Fresh',
  DRIED: 'Dried',
  GROW_KIT: 'Grow kit',
  OTHER: 'Other',
};

function priceLabel(cents: number | null): string {
  return cents == null ? 'Contact for price' : `${money(cents)}/kg`;
}

/** Shell for the buyer-facing portal (no farm sidebar; buyers aren't farm staff). */
function PortalShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-spore">
      <div className="mx-auto max-w-3xl px-4 py-8">{children}</div>
    </div>
  );
}

/** /portal/enter?token=… — exchange a magic link for a session, then redirect. */
export function PortalEnter() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const token = params.get('token');

  useEffect(() => {
    if (!token) {
      setError('This link is missing its access code. Ask the farm to resend your invite.');
      return;
    }
    let alive = true;
    portalApi
      .session(token)
      .then((res) => {
        if (!alive) return;
        setBuyerToken(res.sessionToken);
        navigate('/portal', { replace: true });
      })
      .catch((e) => {
        if (alive) setError(e instanceof ApiError ? e.message : 'This link is invalid or expired.');
      });
    return () => {
      alive = false;
    };
  }, [token, navigate]);

  return (
    <PortalShell>
      <div className="mx-auto mt-20 max-w-md text-center">
        <LogoMark size={40} />
        {error ? (
          <Card className="mt-6">
            <p className="text-sm text-flush">{error}</p>
          </Card>
        ) : (
          <p className="mt-6 text-ink/60">Signing you in…</p>
        )}
      </div>
    </PortalShell>
  );
}

type DibTarget =
  | { kind: 'listing'; listing: ListingAvailability }
  | { kind: 'predicted'; item: PredictedItem };

/** The storefront a purchaser sees for one farm. */
export function Portal() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [target, setTarget] = useState<DibTarget | null>(null);

  const hasToken = !!getBuyerToken();
  const me = useQuery({
    queryKey: ['portal-me'],
    queryFn: portalApi.me,
    enabled: hasToken,
    retry: false,
  });
  const store = useQuery({
    queryKey: ['portal-storefront'],
    queryFn: portalApi.storefront,
    enabled: hasToken,
  });
  const myDibs = useQuery({
    queryKey: ['portal-dibs'],
    queryFn: portalApi.dibs,
    enabled: hasToken,
  });

  if (!hasToken) {
    return (
      <PortalShell>
        <div className="mx-auto mt-20 max-w-md text-center">
          <LogoMark size={40} />
          <h1 className="mt-6 text-xl font-bold text-substrate">Storefront access</h1>
          <p className="mt-2 text-sm text-ink/60">
            Open the invite link the farm sent you to sign in. If it expired, ask them to resend it.
          </p>
        </div>
      </PortalShell>
    );
  }

  // A dead/expired session token → send them back to the access screen.
  if (me.isError && (me.error as ApiError)?.status === 401) {
    setBuyerToken(null);
    return <Navigate to="/portal" replace />;
  }

  const farm = me.data?.farm;

  function signOut() {
    setBuyerToken(null);
    qc.clear();
    navigate('/portal', { replace: true });
  }

  return (
    <PortalShell>
      <header className="mb-6 flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <LogoMark size={26} />
            <h1 className="text-2xl font-bold text-substrate">{farm?.name ?? 'Storefront'}</h1>
          </div>
          {farm?.blurb && <p className="mt-1 max-w-xl text-sm text-ink/60">{farm.blurb}</p>}
        </div>
        <button
          type="button"
          onClick={signOut}
          className="shrink-0 text-xs text-ink/50 hover:text-flush"
        >
          Sign out
        </button>
      </header>

      {store.isLoading ? (
        <Spinner />
      ) : (
        <div className="space-y-8">
          {/* Available now */}
          <section>
            <h2 className="mb-3 text-lg font-semibold text-substrate">Available now</h2>
            {(store.data?.available.length ?? 0) === 0 ? (
              <EmptyState
                title="Nothing listed right now"
                hint="Check back soon — or see what's coming up below."
              />
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                {store.data?.available.map((l) => (
                  <Card key={l.id} className="flex flex-col justify-between">
                    <div>
                      <div className="flex items-center justify-between gap-2">
                        <h3 className="font-semibold text-substrate">{l.title}</h3>
                        <Badge color="neutral">{FORM_LABELS[l.form] ?? l.form}</Badge>
                      </div>
                      <div className="mt-1 text-sm text-ink/60">
                        {formatMass(l.remainingG)} available · {priceLabel(l.pricePerKgCents)}
                      </div>
                      {l.availableAt && (
                        <div className="mt-0.5 text-xs text-ink/50">
                          Ready {formatDate(l.availableAt)}
                        </div>
                      )}
                      {l.notes && <p className="mt-2 text-sm text-ink/70">{l.notes}</p>}
                    </div>
                    <div className="mt-3">
                      <Button
                        className="w-full"
                        onClick={() => setTarget({ kind: 'listing', listing: l })}
                        disabled={l.remainingG <= 0}
                      >
                        {l.remainingG <= 0 ? 'Fully reserved' : 'Call dibs'}
                      </Button>
                    </div>
                  </Card>
                ))}
              </div>
            )}
          </section>

          {/* Predicted / coming soon */}
          {store.data?.showForecast && (store.data?.predicted.length ?? 0) > 0 && (
            <section>
              <h2 className="mb-1 text-lg font-semibold text-substrate">Coming soon (predicted)</h2>
              <p className="mb-3 text-xs text-ink/50">
                Forecasted harvests — call dibs to pre-order and we'll hold it when it's ready.
              </p>
              <Card className="divide-y divide-mycelium p-0">
                {store.data?.predicted.map((p, i) => (
                  <div
                    key={`${p.batchId}-${i}`}
                    className="flex items-center justify-between gap-3 px-4 py-3"
                  >
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium text-substrate">{p.label}</div>
                      <div className="truncate text-xs text-ink/50">
                        {p.stage}
                        {p.expectedYieldG != null ? ` · ~${formatMass(p.expectedYieldG)}` : ''}
                        {p.predictedAt ? ` · ~${formatDate(p.predictedAt)}` : ''}
                      </div>
                    </div>
                    <Button
                      variant="secondary"
                      onClick={() => setTarget({ kind: 'predicted', item: p })}
                    >
                      Pre-order
                    </Button>
                  </div>
                ))}
              </Card>
            </section>
          )}

          {/* Vote for what we grow next (sourced from the farm's library) */}
          {farm?.voting && <VotingSection />}

          {/* My dibs */}
          <section>
            <h2 className="mb-3 text-lg font-semibold text-substrate">My requests</h2>
            {(myDibs.data?.length ?? 0) === 0 ? (
              <p className="text-sm text-ink/50">You haven't called dibs on anything yet.</p>
            ) : (
              <Card className="divide-y divide-mycelium p-0">
                {myDibs.data?.map((d) => (
                  <div key={d.id} className="flex items-center justify-between gap-3 px-4 py-3">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium text-substrate">
                        {d.listing?.title ?? 'Pre-order'}
                        {d.requestedQtyG ? ` · ${formatMass(d.requestedQtyG)}` : ''}
                      </div>
                      {d.note && <div className="truncate text-xs text-ink/50">{d.note}</div>}
                    </div>
                    <div className="flex shrink-0 items-center gap-3">
                      <DibStatusBadge status={d.status} />
                      {(d.status === 'PENDING' || d.status === 'APPROVED') && (
                        <CancelDib id={d.id} />
                      )}
                    </div>
                  </div>
                ))}
              </Card>
            )}
          </section>
        </div>
      )}

      {target && <DibModal target={target} onClose={() => setTarget(null)} />}
    </PortalShell>
  );
}

/** Buyers vote for which library strain the farm should grow next. */
function VotingSection() {
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const q = useQuery({ queryKey: ['portal-votes'], queryFn: portalApi.votes });
  const toggle = useMutation({
    mutationFn: (c: VoteCandidate) =>
      c.voted ? portalApi.unvote(c.strainId) : portalApi.vote(c.strainId),
    onMutate: () => setError(null),
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Could not save your vote.'),
    // Reconcile on success AND failure so the list reflects the true state.
    onSettled: () => qc.invalidateQueries({ queryKey: ['portal-votes'] }),
  });
  const candidates = q.data?.candidates ?? [];
  if (q.isLoading || candidates.length === 0) return null;
  return (
    <section>
      <h2 className="mb-1 text-lg font-semibold text-substrate">Vote for what we grow next</h2>
      <p className="mb-3 text-xs text-ink/50">
        Tell the farm which strains you want to see next. One vote per strain — change your mind any
        time.
      </p>
      <Card className="divide-y divide-mycelium p-0">
        {candidates.map((c) => (
          <div key={c.strainId} className="flex items-center justify-between gap-3 px-4 py-3">
            <div className="min-w-0">
              <div className="truncate text-sm font-medium text-substrate">{c.name}</div>
              <div className="truncate text-xs text-ink/50">
                {c.species ? <span className="italic">{c.species}</span> : c.category.toLowerCase()}
                {c.votes > 0 ? ` · ${c.votes} vote${c.votes === 1 ? '' : 's'}` : ''}
              </div>
            </div>
            <Button
              variant={c.voted ? 'secondary' : undefined}
              onClick={() => toggle.mutate(c)}
              disabled={toggle.isPending && toggle.variables?.strainId === c.strainId}
            >
              {c.voted ? '✓ Voted' : 'Vote'}
            </Button>
          </div>
        ))}
      </Card>
      {error && <p className="mt-2 text-sm text-flush">{error}</p>}
    </section>
  );
}

function DibStatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; color: 'green' | 'amber' | 'red' | 'neutral' }> = {
    PENDING: { label: 'Pending', color: 'amber' },
    APPROVED: { label: 'Approved', color: 'green' },
    DECLINED: { label: 'Declined', color: 'red' },
    CANCELLED: { label: 'Cancelled', color: 'neutral' },
    FULFILLED: { label: 'Fulfilled', color: 'green' },
  };
  const m = map[status] ?? { label: status, color: 'neutral' as const };
  return <Badge color={m.color}>{m.label}</Badge>;
}

function CancelDib({ id }: { id: string }) {
  const qc = useQueryClient();
  const cancel = useMutation({
    mutationFn: () => portalApi.cancelDib(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['portal-dibs'] }),
  });
  return (
    <button
      type="button"
      onClick={() => cancel.mutate()}
      disabled={cancel.isPending}
      className="text-xs text-ink/40 hover:text-flush"
    >
      cancel
    </button>
  );
}

function DibModal({ target, onClose }: { target: DibTarget; onClose: () => void }) {
  const qc = useQueryClient();
  const [qty, setQty] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);

  const title = target.kind === 'listing' ? target.listing.title : target.item.label;
  const isPredicted = target.kind === 'predicted';

  const create = useMutation({
    mutationFn: () =>
      portalApi.callDibs({
        listingId: target.kind === 'listing' ? target.listing.id : null,
        batchId: target.kind === 'predicted' ? target.item.batchId || null : null,
        requestedQtyG: qty ? Number(qty) * 1000 : null, // buyer enters kg
        note: note.trim() || null,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['portal-dibs'] });
      qc.invalidateQueries({ queryKey: ['portal-storefront'] });
      onClose();
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Could not submit your request.'),
  });

  return (
    <Modal
      open
      onClose={onClose}
      title={isPredicted ? `Pre-order: ${title}` : `Call dibs: ${title}`}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          create.mutate();
        }}
        className="space-y-4"
      >
        <p className="text-sm text-ink/60">
          Send the farm a request. They'll confirm and follow up — nothing is charged here.
        </p>
        <Field label="How much? (kg, optional)">
          <Input
            type="number"
            step="0.1"
            min={0}
            value={qty}
            onChange={(e) => setQty(e.target.value)}
            placeholder="e.g. 2"
          />
        </Field>
        <Field label="Note to the farm (optional)">
          <Textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            placeholder="Pickup timing, preferences, etc."
          />
        </Field>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={create.isPending}>
            {create.isPending ? 'Sending…' : 'Send request'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
