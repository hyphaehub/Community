import { type CalendarMilestone, type ForecastCalendar, api } from '@/lib/api';
import { formatDate, formatMass } from '@/lib/format';
import { colors } from '@/lib/theme';
import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

const DAY_MS = 86_400_000;

const STATUS: Record<string, { label: string; bg: string; fg: string }> = {
  done: { label: 'Logged', bg: '#E4EDD8', fg: colors.hyphaeDark },
  overdue: { label: 'Overdue', bg: '#F6DAD3', fg: '#9B3B22' },
  due: { label: 'Due soon', bg: '#F7E8CE', fg: '#8A5A1B' },
  upcoming: { label: 'Upcoming', bg: colors.mycelium, fg: colors.cap },
  stalled: { label: 'Ended', bg: colors.mycelium, fg: colors.cap },
};

function Pill({ status }: { status: string }) {
  const s = STATUS[status] ?? STATUS.upcoming;
  return (
    <View style={[styles.pill, { backgroundColor: s.bg }]}>
      <Text style={[styles.pillText, { color: s.fg }]}>{s.label}</Text>
    </View>
  );
}

function Row({ m }: { m: CalendarMilestone }) {
  return (
    <View style={styles.row}>
      <View style={{ flex: 1, paddingRight: 8 }}>
        <Text style={styles.rowTitle} numberOfLines={1}>
          {m.label}
          {m.batchName ? ` · ${m.batchName}` : ''}
        </Text>
        <Text style={styles.rowSub}>
          {formatDate(m.predictedAt)}
          {m.expectedYieldG != null ? ` · ~${formatMass(m.expectedYieldG)} dry` : ''}
        </Text>
      </View>
      <Pill status={m.status} />
    </View>
  );
}

export default function Schedule() {
  const [data, setData] = useState<ForecastCalendar | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      setData(await api.forecastCalendar());
    } finally {
      setLoading(false);
    }
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

  const now = Date.now();
  const upcoming = (data?.milestones ?? [])
    .filter(
      (m) => !m.actualAt && m.predictedAt && new Date(m.predictedAt).getTime() >= now - DAY_MS,
    )
    .slice(0, 20);
  const overdue = (data?.milestones ?? []).filter((m) => m.status === 'overdue');
  // Current week = the latest bucket starting on or before today (local YYYY-MM-DD),
  // robust to the API's UTC-anchored week keys across device time zones.
  const todayKey = new Date().toLocaleDateString('en-CA');
  const thisWeek = [...(data?.weeks ?? [])]
    .reverse()
    .find((w) => w.weekStart.slice(0, 10) <= todayKey);

  return (
    <ScrollView
      style={{ backgroundColor: colors.spore }}
      contentContainerStyle={{ padding: 16 }}
      refreshControl={
        <RefreshControl refreshing={false} onRefresh={load} tintColor={colors.hyphae} />
      }
    >
      {data?.nextHarvest ? (
        <View style={styles.next}>
          <Text style={styles.nextLabel}>NEXT HARVEST</Text>
          <Text style={styles.nextDate}>{formatDate(data.nextHarvest.date)}</Text>
          <Text style={styles.nextSub}>
            {data.nextHarvest.batchName}
            {data.nextHarvest.expectedYieldG != null
              ? ` · ~${formatMass(data.nextHarvest.expectedYieldG)} dry`
              : ''}
          </Text>
        </View>
      ) : (
        <View style={styles.next}>
          <Text style={styles.nextLabel}>NEXT HARVEST</Text>
          <Text style={styles.nextSub}>Nothing projected yet. Start a batch to see its cycle.</Text>
        </View>
      )}

      <View style={styles.grid}>
        <View style={styles.stat}>
          <Text style={styles.statLabel}>This week</Text>
          <Text style={styles.statValue}>
            {thisWeek?.expectedYieldG != null
              ? formatMass(thisWeek.expectedYieldG)
              : (thisWeek?.harvestCount ?? 0)}
          </Text>
          <Text style={styles.statSub}>{thisWeek?.harvestCount ?? 0} harvests due</Text>
        </View>
        <View style={styles.stat}>
          <Text style={styles.statLabel}>Output gaps</Text>
          <Text style={styles.statValue}>{data?.gaps.length ?? 0}</Text>
          <Text style={styles.statSub}>
            {data?.gaps.length ? 'weeks with none' : 'steady pipeline'}
          </Text>
        </View>
      </View>

      {data?.staggerHint ? (
        <View style={styles.hint}>
          <Text style={styles.hintText}>
            To harvest the week of {formatDate(data.staggerHint.gapWeekStart)}, start a new batch by{' '}
            {formatDate(data.staggerHint.inoculateBy)}.
          </Text>
        </View>
      ) : null}

      {overdue.length > 0 ? (
        <>
          <Text style={styles.section}>Overdue</Text>
          {overdue.map((m, i) => (
            <Row key={`od-${m.batchId}-${m.stage}-${i}`} m={m} />
          ))}
        </>
      ) : null}

      <Text style={styles.section}>Upcoming</Text>
      {upcoming.length === 0 ? (
        <Text style={styles.empty}>Nothing scheduled. Predicted stages will appear here.</Text>
      ) : (
        upcoming.map((m, i) => <Row key={`up-${m.batchId}-${m.stage}-${i}`} m={m} />)
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.spore,
  },
  next: {
    backgroundColor: '#FBEFE4',
    borderColor: colors.flush,
    borderWidth: 1,
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
  },
  nextLabel: { fontSize: 11, fontWeight: '700', color: colors.cap, letterSpacing: 0.5 },
  nextDate: { fontSize: 24, fontWeight: '800', color: colors.substrate, marginTop: 2 },
  nextSub: { color: colors.ink, opacity: 0.7, marginTop: 2 },
  grid: { flexDirection: 'row', gap: 10 },
  stat: {
    flex: 1,
    backgroundColor: colors.white,
    borderColor: colors.mycelium,
    borderWidth: 1,
    borderRadius: 14,
    padding: 14,
  },
  statLabel: { fontSize: 11, textTransform: 'uppercase', color: colors.cap, fontWeight: '600' },
  statValue: { fontSize: 22, fontWeight: '800', color: colors.substrate, marginTop: 4 },
  statSub: { fontSize: 11, color: colors.ink, opacity: 0.5 },
  hint: {
    backgroundColor: colors.parchment,
    borderColor: colors.mycelium,
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    marginTop: 12,
  },
  hintText: { color: colors.ink, opacity: 0.75, fontSize: 13 },
  section: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.substrate,
    marginTop: 24,
    marginBottom: 8,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.white,
    borderColor: colors.mycelium,
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    marginBottom: 8,
  },
  rowTitle: { fontWeight: '600', color: colors.substrate },
  rowSub: { color: colors.ink, opacity: 0.55, fontSize: 12, marginTop: 2 },
  pill: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3 },
  pillText: { fontSize: 11, fontWeight: '700' },
  empty: { color: colors.ink, opacity: 0.5 },
});
