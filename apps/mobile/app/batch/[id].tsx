import {
  CULTURE_TYPE_LABELS,
  EVENT_LABELS,
  EVENT_TYPES,
  SOURCE_TYPES,
  STATUS_LABELS,
  toCents,
} from '@hyphaehub/core';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import {
  ActivityIndicator,
  Alert,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { api, type BatchDetail, type BatchForecast, type Culture } from '@/lib/api';
import { formatDate, formatMass, money, perGram } from '@/lib/format';
import { colors } from '@/lib/theme';

const FORECAST_STATUS: Record<string, { label: string; bg: string; fg: string }> = {
  done: { label: 'Logged', bg: '#E4EDD8', fg: colors.hyphaeDark },
  overdue: { label: 'Overdue', bg: '#F6DAD3', fg: '#9B3B22' },
  due: { label: 'Due soon', bg: '#F7E8CE', fg: '#8A5A1B' },
  upcoming: { label: 'Upcoming', bg: colors.mycelium, fg: colors.cap },
  stalled: { label: 'Ended', bg: colors.mycelium, fg: colors.cap },
};

type Action =
  | { kind: 'none' }
  | { kind: 'source' }
  | { kind: 'combine' }
  | { kind: 'split'; culture: Culture }
  | { kind: 'event'; culture: Culture }
  | { kind: 'harvest'; culture: Culture };

export default function BatchScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [data, setData] = useState<BatchDetail | null>(null);
  const [forecast, setForecast] = useState<BatchForecast | null>(null);
  const [loading, setLoading] = useState(true);
  const [action, setAction] = useState<Action>({ kind: 'none' });
  const [form, setForm] = useState<Record<string, string>>({});
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    const [d, fc] = await Promise.all([api.batch(id), api.forecastBatch(id).catch(() => null)]);
    setData(d);
    setForecast(fc);
    setLoading(false);
  }, [id]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  function open(a: Action) {
    setForm({});
    setSelected([]);
    setAction(a);
  }
  const f = (k: string) => form[k] ?? '';
  const setF = (k: string, v: string) => setForm((p) => ({ ...p, [k]: v }));

  async function submit() {
    if (!id) return;
    setBusy(true);
    try {
      if (action.kind === 'source') {
        await api.createSource(id, data?.batch.strainId ?? null, f('label') || 'Source', f('sourceType') || 'LIQUID_CULTURE');
      } else if (action.kind === 'split') {
        const cost = f('cost') ? toCents(f('cost')) : undefined;
        await api.split(action.culture.id, id, Number(f('count') || '4'), f('prefix') || `${action.culture.label} Jar`, cost);
      } else if (action.kind === 'combine') {
        if (selected.length === 0) throw new Error('Select at least one jar');
        const cost = f('cost') ? toCents(f('cost')) : undefined;
        await api.combine(id, selected, f('label') || 'Tub', f('dry') ? Number(f('dry')) : undefined, cost);
      } else if (action.kind === 'harvest') {
        await api.logHarvest(action.culture.id, id, Number(f('flush') || '1'), Number(f('wet') || '0'), f('dry') ? Number(f('dry')) : undefined);
      } else if (action.kind === 'event') {
        const pct = f('pct') ? { colonizationPct: Number(f('pct')) } : undefined;
        await api.logEvent(action.culture.id, f('type') || 'COLONIZATION_CHECK', f('note') || undefined, pct);
      }
      setAction({ kind: 'none' });
      await load();
    } catch (e) {
      Alert.alert('Error', e instanceof Error ? e.message : 'Failed');
    } finally {
      setBusy(false);
    }
  }

  if (loading || !data) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.hyphae} />
      </View>
    );
  }

  const { batch, cultures, harvests, summary } = data;
  const sources = cultures.filter((c) => ['SOURCE', 'AGAR', 'LIQUID_CULTURE'].includes(c.type));
  const grain = cultures.filter((c) => c.type === 'GRAIN');
  const tubs = cultures.filter((c) => c.type === 'BULK');

  return (
    <>
      <Stack.Screen options={{ title: batch.name }} />
      <ScrollView style={{ backgroundColor: colors.spore }} contentContainerStyle={{ padding: 16 }}>
        {/* Summary */}
        <View style={styles.statGrid}>
          <Stat label="Cost" value={money(summary.cost.totalCents)} />
          <Stat label="Wet" value={formatMass(summary.yield.totalWetG)} />
          <Stat label="Dry" value={formatMass(summary.yield.totalDryG)} />
          <Stat label="Bio. eff." value={summary.efficiency.biologicalEfficiency != null ? `${summary.efficiency.biologicalEfficiency}%` : '—'} />
          <Stat label="Cost/dry g" value={perGram(summary.efficiency.costPerDryGramCents)} />
          <Stat label="Flushes" value={String(summary.yield.flushCount)} />
        </View>

        <Section title="Source" onAdd={() => open({ kind: 'source' })} addLabel="+ Source">
          {sources.map((c) => (
            <CultureRow key={c.id} c={c} actions={[
              { label: 'Split', onPress: () => open({ kind: 'split', culture: c }) },
              { label: 'Event', onPress: () => open({ kind: 'event', culture: c }) },
            ]} />
          ))}
          {sources.length === 0 && <Empty text="Add a source to begin." />}
        </Section>

        <Section title="Grain spawn" onAdd={grain.length ? () => open({ kind: 'combine' }) : undefined} addLabel="Combine → tub">
          {grain.map((c) => (
            <CultureRow key={c.id} c={c} actions={[
              { label: 'Split', onPress: () => open({ kind: 'split', culture: c }) },
              { label: 'Event', onPress: () => open({ kind: 'event', culture: c }) },
            ]} />
          ))}
          {grain.length === 0 && <Empty text="Split a source into jars." />}
        </Section>

        <Section title="Fruiting tubs">
          {tubs.map((c) => (
            <CultureRow key={c.id} c={c} actions={[
              { label: 'Harvest', accent: true, onPress: () => open({ kind: 'harvest', culture: c }) },
              { label: 'Event', onPress: () => open({ kind: 'event', culture: c }) },
            ]} />
          ))}
          {tubs.length === 0 && <Empty text="Combine jars into a tub." />}
        </Section>

        {harvests.length > 0 && (
          <Section title="Harvests">
            {harvests.map((h) => (
              <View key={h.id} style={styles.harvestRow}>
                <Text style={styles.rowTitle}>Flush {h.flushNumber}</Text>
                <Text style={styles.rowSub}>
                  {formatMass(h.wetWeightG)} wet · {h.dryWeightG != null ? `${formatMass(h.dryWeightG)} dry` : 'drying'}
                </Text>
              </View>
            ))}
          </Section>
        )}

        {forecast && forecast.timeline.length > 0 && (
          <Section title="Predicted timeline">
            {forecast.timeline.map((m) => {
              const s = FORECAST_STATUS[m.status] ?? FORECAST_STATUS.upcoming;
              const variance =
                m.actualAt && m.varianceDays != null
                  ? m.varianceDays === 0
                    ? 'on time'
                    : m.varianceDays > 0
                      ? `${m.varianceDays}d late`
                      : `${Math.abs(m.varianceDays)}d early`
                  : null;
              return (
                <View key={m.stage} style={styles.harvestRow}>
                  <View style={{ flex: 1, paddingRight: 8 }}>
                    <Text style={styles.rowTitle}>{m.label}</Text>
                    <Text style={styles.rowSub}>
                      {m.actualAt
                        ? `Logged ${formatDate(m.actualAt)}`
                        : m.predictedAt
                          ? `Projected ${formatDate(m.predictedAt)}`
                          : 'Not scheduled'}
                      {m.flushNumber != null && m.expectedYieldG != null
                        ? ` · ~${formatMass(m.expectedYieldG)} dry`
                        : ''}
                      {variance ? ` · ${variance}` : ''}
                    </Text>
                  </View>
                  <Text style={[styles.statusBadge, { backgroundColor: s.bg, color: s.fg }]}>{s.label}</Text>
                </View>
              );
            })}
          </Section>
        )}
      </ScrollView>

      <ActionModal
        action={action}
        grain={grain}
        selected={selected}
        setSelected={setSelected}
        f={f}
        setF={setF}
        busy={busy}
        onClose={() => setAction({ kind: 'none' })}
        onSubmit={submit}
      />
    </>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={styles.statValue}>{value}</Text>
    </View>
  );
}

function Section({ title, children, onAdd, addLabel }: { title: string; children: React.ReactNode; onAdd?: () => void; addLabel?: string }) {
  return (
    <View style={{ marginTop: 20 }}>
      <View style={styles.sectionHead}>
        <Text style={styles.sectionTitle}>{title}</Text>
        {onAdd && (
          <TouchableOpacity onPress={onAdd}>
            <Text style={styles.addLink}>{addLabel}</Text>
          </TouchableOpacity>
        )}
      </View>
      <View style={{ gap: 8 }}>{children}</View>
    </View>
  );
}

function Empty({ text }: { text: string }) {
  return <Text style={styles.empty}>{text}</Text>;
}

function CultureRow({ c, actions }: { c: Culture; actions: { label: string; onPress: () => void; accent?: boolean }[] }) {
  return (
    <View style={styles.card}>
      <View style={styles.rowBetween}>
        <Text style={styles.rowTitle}>{c.label}</Text>
        <Text style={styles.statusBadge}>{STATUS_LABELS[c.status]}</Text>
      </View>
      <Text style={styles.rowSub}>
        {CULTURE_TYPE_LABELS[c.type]}
        {c.colonizationPct != null ? ` · ${c.colonizationPct}%` : ''}
      </Text>
      <View style={styles.actionsRow}>
        {actions.map((a) => (
          <TouchableOpacity key={a.label} onPress={a.onPress}>
            <Text style={[styles.actionLink, a.accent && { color: colors.flush }]}>{a.label}</Text>
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );
}

function Input({ f, setF, k, placeholder, numeric }: { f: (k: string) => string; setF: (k: string, v: string) => void; k: string; placeholder: string; numeric?: boolean }) {
  return (
    <TextInput
      style={styles.input}
      placeholder={placeholder}
      keyboardType={numeric ? 'numeric' : 'default'}
      value={f(k)}
      onChangeText={(v) => setF(k, v)}
    />
  );
}

function ActionModal(props: {
  action: Action;
  grain: Culture[];
  selected: string[];
  setSelected: (s: string[]) => void;
  f: (k: string) => string;
  setF: (k: string, v: string) => void;
  busy: boolean;
  onClose: () => void;
  onSubmit: () => void;
}) {
  const { action, grain, selected, setSelected, f, setF, busy, onClose, onSubmit } = props;
  const visible = action.kind !== 'none';
  const titles: Record<string, string> = {
    source: 'Add a source',
    split: 'Split into jars',
    combine: 'Combine into a tub',
    harvest: 'Log harvest',
    event: 'Log event',
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.modalBg}>
        <View style={styles.sheet}>
          <Text style={styles.sheetTitle}>{titles[action.kind] ?? ''}</Text>

          {action.kind === 'source' && (
            <>
              <Input f={f} setF={setF} k="label" placeholder="Label (e.g. GT Liquid Culture)" />
              <Text style={styles.fieldLabel}>Type</Text>
              <ChoiceRow options={[...SOURCE_TYPES]} value={f('sourceType') || 'LIQUID_CULTURE'} onChange={(v) => setF('sourceType', v)} />
            </>
          )}

          {action.kind === 'split' && (
            <>
              <Input f={f} setF={setF} k="count" placeholder="How many jars (e.g. 4)" numeric />
              <Input f={f} setF={setF} k="prefix" placeholder={`Label prefix (${action.culture.label} Jar)`} />
              <Input f={f} setF={setF} k="cost" placeholder="Cost per jar $ (optional)" numeric />
            </>
          )}

          {action.kind === 'combine' && (
            <>
              <Text style={styles.fieldLabel}>Jars to combine</Text>
              <View style={styles.jarList}>
                {grain.filter((c) => c.status !== 'SPENT').map((c) => {
                  const on = selected.includes(c.id);
                  return (
                    <TouchableOpacity
                      key={c.id}
                      style={[styles.jar, on && styles.jarOn]}
                      onPress={() => setSelected(on ? selected.filter((x) => x !== c.id) : [...selected, c.id])}
                    >
                      <Text style={[styles.jarText, on && { color: colors.spore }]}>{c.label}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
              <Input f={f} setF={setF} k="label" placeholder="Tub label (e.g. Monotub A)" />
              <Input f={f} setF={setF} k="dry" placeholder="Dry substrate g (for bio. eff.)" numeric />
              <Input f={f} setF={setF} k="cost" placeholder="Substrate cost $ (optional)" numeric />
            </>
          )}

          {action.kind === 'harvest' && (
            <>
              <Input f={f} setF={setF} k="flush" placeholder="Flush # (e.g. 1)" numeric />
              <Input f={f} setF={setF} k="wet" placeholder="Wet grams" numeric />
              <Input f={f} setF={setF} k="dry" placeholder="Dry grams (optional)" numeric />
            </>
          )}

          {action.kind === 'event' && (
            <>
              <Text style={styles.fieldLabel}>Event</Text>
              <ChoiceRow options={[...EVENT_TYPES]} labels={EVENT_LABELS} value={f('type') || 'COLONIZATION_CHECK'} onChange={(v) => setF('type', v)} />
              <Input f={f} setF={setF} k="pct" placeholder="Colonization % (optional)" numeric />
              <Input f={f} setF={setF} k="note" placeholder="Note (optional)" />
            </>
          )}

          <View style={styles.sheetActions}>
            <TouchableOpacity style={styles.cancel} onPress={onClose}>
              <Text style={styles.cancelText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.save} onPress={onSubmit} disabled={busy}>
              <Text style={styles.saveText}>{busy ? 'Saving…' : 'Save'}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

function ChoiceRow({ options, value, onChange, labels }: { options: string[]; value: string; onChange: (v: string) => void; labels?: Record<string, string> }) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 10 }}>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        {options.map((o) => (
          <TouchableOpacity key={o} style={[styles.choice, value === o && styles.choiceOn]} onPress={() => onChange(o)}>
            <Text style={[styles.choiceText, value === o && { color: colors.spore }]}>
              {(labels?.[o] ?? o.replace(/_/g, ' ').toLowerCase())}
            </Text>
          </TouchableOpacity>
        ))}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.spore },
  statGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  stat: { width: '31%', backgroundColor: colors.white, borderColor: colors.mycelium, borderWidth: 1, borderRadius: 12, padding: 10 },
  statLabel: { fontSize: 10, textTransform: 'uppercase', color: colors.cap, fontWeight: '600' },
  statValue: { fontSize: 16, fontWeight: '800', color: colors.substrate, marginTop: 2 },
  sectionHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  sectionTitle: { fontSize: 16, fontWeight: '700', color: colors.substrate },
  addLink: { color: colors.hyphaeDark, fontWeight: '600' },
  card: { backgroundColor: colors.white, borderColor: colors.mycelium, borderWidth: 1, borderRadius: 12, padding: 12 },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  rowTitle: { fontWeight: '600', color: colors.substrate },
  rowSub: { color: colors.ink, opacity: 0.55, marginTop: 2, fontSize: 12 },
  statusBadge: { fontSize: 11, fontWeight: '600', color: colors.hyphaeDark, backgroundColor: '#e2ecd4', borderRadius: 999, paddingVertical: 2, paddingHorizontal: 8, overflow: 'hidden' },
  actionsRow: { flexDirection: 'row', gap: 16, marginTop: 8 },
  actionLink: { color: colors.hyphaeDark, fontWeight: '600', fontSize: 13 },
  harvestRow: { flexDirection: 'row', justifyContent: 'space-between', backgroundColor: colors.white, borderColor: colors.mycelium, borderWidth: 1, borderRadius: 12, padding: 12 },
  empty: { color: colors.ink, opacity: 0.45, fontSize: 13 },
  modalBg: { flex: 1, backgroundColor: 'rgba(36,30,26,0.4)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: colors.parchment, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, paddingBottom: 36 },
  sheetTitle: { fontSize: 18, fontWeight: '800', color: colors.substrate, marginBottom: 14 },
  fieldLabel: { color: colors.ink, opacity: 0.7, fontWeight: '600', marginBottom: 6 },
  input: { borderWidth: 1, borderColor: colors.mycelium, backgroundColor: colors.white, borderRadius: 10, padding: 12, marginBottom: 10 },
  jarList: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 10 },
  jar: { borderWidth: 1, borderColor: colors.mycelium, borderRadius: 999, paddingVertical: 6, paddingHorizontal: 12, backgroundColor: colors.white },
  jarOn: { backgroundColor: colors.hyphaeDark, borderColor: colors.hyphaeDark },
  jarText: { color: colors.ink, fontSize: 13 },
  choice: { borderWidth: 1, borderColor: colors.mycelium, borderRadius: 999, paddingVertical: 6, paddingHorizontal: 12, backgroundColor: colors.white },
  choiceOn: { backgroundColor: colors.hyphaeDark, borderColor: colors.hyphaeDark },
  choiceText: { color: colors.ink, fontSize: 13 },
  sheetActions: { flexDirection: 'row', gap: 10, marginTop: 8 },
  cancel: { flex: 1, padding: 14, alignItems: 'center', borderRadius: 12, backgroundColor: colors.mycelium },
  cancelText: { color: colors.ink, fontWeight: '600' },
  save: { flex: 1, padding: 14, alignItems: 'center', borderRadius: 12, backgroundColor: colors.hyphaeDark },
  saveText: { color: colors.spore, fontWeight: '700' },
});
