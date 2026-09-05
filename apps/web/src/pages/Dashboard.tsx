import { yieldTotals } from '@hyphaehub/core';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { BatchStatusBadge, CultureStatusBadge } from '../components/status';
import { Card, EmptyState, PageHeader, SectionTitle, Spinner, Stat } from '../components/ui';
import { api } from '../lib/api';
import { formatMass, formatDate, money } from '../lib/format';

export function Dashboard() {
  const me = useQuery({ queryKey: ['me'], queryFn: api.me });
  const batches = useQuery({ queryKey: ['batches'], queryFn: () => api.batches.list() });
  const cultures = useQuery({ queryKey: ['cultures'], queryFn: () => api.cultures.list() });
  const harvests = useQuery({ queryKey: ['harvests'], queryFn: () => api.harvests.list() });
  const costs = useQuery({ queryKey: ['costs'], queryFn: () => api.costs.list() });

  if (me.isLoading || batches.isLoading || cultures.isLoading) return <Spinner />;

  const cs = cultures.data ?? [];
  const activeTubs = cs.filter(
    (c) => c.type === 'BULK' && !['SPENT', 'CONTAMINATED'].includes(c.status),
  );
  const colonizing = cs.filter(
    (c) => c.type !== 'BULK' && ['INOCULATED', 'COLONIZING'].includes(c.status),
  );
  const totals = yieldTotals(
    (harvests.data ?? []).map((h) => ({ wetWeightG: h.wetWeightG, dryWeightG: h.dryWeightG })),
  );
  const spend = costs.data?.totalCents ?? 0;
  const recentBatches = (batches.data ?? []).slice(0, 5);

  return (
    <div>
      <PageHeader
        title={`Welcome back${me.data ? `, ${me.data.user.name.split(' ')[0]}` : ''}`}
        subtitle="Your grow at a glance."
        action={
          <Link
            to="/batches"
            className="rounded-lg bg-hyphae-600 px-4 py-2 text-sm font-medium text-spore hover:bg-hyphae-700"
          >
            + New batch
          </Link>
        }
      />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        <Stat
          label="Active batches"
          value={me.data?.usage.activeBatches ?? 0}
          sub={
            me.data?.limits.maxActiveBatches != null
              ? `of ${me.data.limits.maxActiveBatches} on ${me.data.limits.label}`
              : 'unlimited'
          }
        />
        <Stat label="Active tubs" value={activeTubs.length} sub="fruiting & colonizing" />
        <Stat label="Colonizing" value={colonizing.length} sub="jars / cultures" />
        <Stat label="Total dry yield" value={formatMass(totals.totalDryG)} sub={`${totals.harvestCount} harvests`} />
        {me.data?.features?.costs !== false && (
          <Stat label="Total spend" value={money(spend)} sub="all batches" />
        )}
      </div>

      <div className="mt-8 grid gap-6 lg:grid-cols-2">
        <div>
          <SectionTitle
            action={
              <Link to="/batches" className="text-sm font-medium text-hyphae-700 hover:underline">
                View all
              </Link>
            }
          >
            Recent batches
          </SectionTitle>
          {recentBatches.length === 0 ? (
            <EmptyState
              title="No batches yet"
              hint="Create your first batch, then add a source and split it into jars."
              action={
                <Link
                  to="/batches"
                  className="rounded-lg bg-hyphae-600 px-4 py-2 text-sm font-medium text-spore"
                >
                  Start a batch
                </Link>
              }
            />
          ) : (
            <div className="space-y-2">
              {recentBatches.map((b) => (
                <Link key={b.id} to={`/batches/${b.id}`}>
                  <Card className="flex items-center justify-between p-4 transition-colors hover:border-hyphae-300">
                    <div>
                      <div className="font-medium text-substrate">{b.name}</div>
                      <div className="text-xs text-ink/50">Started {formatDate(b.startedAt)}</div>
                    </div>
                    <BatchStatusBadge status={b.status} />
                  </Card>
                </Link>
              ))}
            </div>
          )}
        </div>

        <div>
          <SectionTitle>Colonizing now</SectionTitle>
          {colonizing.length === 0 ? (
            <EmptyState title="Nothing colonizing" hint="Grain jars in progress will show up here." />
          ) : (
            <div className="space-y-2">
              {colonizing.slice(0, 6).map((c) => (
                <Card key={c.id} className="flex items-center justify-between p-4">
                  <div>
                    <div className="font-medium text-substrate">{c.label}</div>
                    <div className="text-xs text-ink/50">
                      {c.colonizationPct != null ? `${c.colonizationPct}% colonized` : c.substrateType}
                    </div>
                  </div>
                  <CultureStatusBadge status={c.status} />
                </Card>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
