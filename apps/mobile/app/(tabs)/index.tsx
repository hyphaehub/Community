import { yieldTotals } from '@hyphaehub/core';
import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { api, type Batch, type Culture, type Harvest, type Me } from '@/lib/api';
import { formatMass } from '@/lib/format';
import { colors } from '@/lib/theme';

function Stat({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={styles.statValue}>{value}</Text>
      {sub ? <Text style={styles.statSub}>{sub}</Text> : null}
    </View>
  );
}

export default function Home() {
  const [me, setMe] = useState<Me | null>(null);
  const [batches, setBatches] = useState<Batch[]>([]);
  const [cultures, setCultures] = useState<Culture[]>([]);
  const [harvests, setHarvests] = useState<Harvest[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const [m, b, c, h] = await Promise.all([
      api.me(),
      api.batches(),
      api.allCultures(),
      api.allHarvests(),
    ]);
    setMe(m);
    setBatches(b);
    setCultures(c);
    setHarvests(h);
    setLoading(false);
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.hyphae} />
      </View>
    );
  }

  const tubs = cultures.filter((c) => c.type === 'BULK' && !['SPENT', 'CONTAMINATED'].includes(c.status));
  const colonizing = cultures.filter((c) => c.type !== 'BULK' && ['INOCULATED', 'COLONIZING'].includes(c.status));
  const totals = yieldTotals(harvests.map((h) => ({ wetWeightG: h.wetWeightG, dryWeightG: h.dryWeightG })));

  return (
    <ScrollView
      style={{ backgroundColor: colors.spore }}
      contentContainerStyle={{ padding: 16 }}
      refreshControl={<RefreshControl refreshing={false} onRefresh={load} tintColor={colors.hyphae} />}
    >
      {me ? (
        <>
          <Text style={styles.hi}>Hi, {me.user.name.split(' ')[0]}</Text>
          <Text style={styles.sub}>
            {me.workspace.name} · {me.limits.label} plan
          </Text>
        </>
      ) : null}

      <View style={styles.grid}>
        <Stat
          label="Active batches"
          value={me?.usage.activeBatches ?? 0}
          sub={me?.limits.maxActiveBatches != null ? `of ${me.limits.maxActiveBatches}` : 'unlimited'}
        />
        <Stat label="Active tubs" value={tubs.length} />
        <Stat label="Colonizing" value={colonizing.length} />
        <Stat label="Dry yield" value={formatMass(totals.totalDryG)} sub={`${totals.harvestCount} harvests`} />
      </View>

      <Text style={styles.section}>Colonizing now</Text>
      {colonizing.length === 0 ? (
        <Text style={styles.empty}>Nothing colonizing right now.</Text>
      ) : (
        colonizing.slice(0, 6).map((c) => (
          <View key={c.id} style={styles.row}>
            <Text style={styles.rowTitle}>{c.label}</Text>
            <Text style={styles.rowSub}>
              {c.colonizationPct != null ? `${c.colonizationPct}%` : c.status.toLowerCase()}
            </Text>
          </View>
        ))
      )}

      <Text style={styles.section}>Recent batches</Text>
      {batches.slice(0, 5).map((b) => (
        <View key={b.id} style={styles.row}>
          <Text style={styles.rowTitle}>{b.name}</Text>
          <Text style={styles.rowSub}>{b.status.toLowerCase()}</Text>
        </View>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.spore },
  hi: { fontSize: 24, fontWeight: '800', color: colors.substrate },
  sub: { color: colors.ink, opacity: 0.6, marginBottom: 16 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  stat: {
    width: '47%',
    backgroundColor: colors.white,
    borderColor: colors.mycelium,
    borderWidth: 1,
    borderRadius: 14,
    padding: 14,
  },
  statLabel: { fontSize: 11, textTransform: 'uppercase', color: colors.cap, fontWeight: '600' },
  statValue: { fontSize: 22, fontWeight: '800', color: colors.substrate, marginTop: 4 },
  statSub: { fontSize: 11, color: colors.ink, opacity: 0.5 },
  section: { fontSize: 16, fontWeight: '700', color: colors.substrate, marginTop: 24, marginBottom: 8 },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    backgroundColor: colors.white,
    borderColor: colors.mycelium,
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    marginBottom: 8,
  },
  rowTitle: { fontWeight: '600', color: colors.substrate },
  rowSub: { color: colors.ink, opacity: 0.55 },
  empty: { color: colors.ink, opacity: 0.5 },
  spend: { marginTop: 20, color: colors.ink, opacity: 0.6, textAlign: 'center' },
});
