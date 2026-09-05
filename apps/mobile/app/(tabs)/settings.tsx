import { useRouter } from 'expo-router';
import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Linking, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { api, API_URL, type Me } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { colors } from '@/lib/theme';

function Meter({ label, used, limit }: { label: string; used: number; limit: number | null }) {
  const pct = limit == null ? 8 : Math.min(100, Math.round((used / limit) * 100));
  return (
    <View style={{ marginBottom: 14 }}>
      <View style={styles.meterRow}>
        <Text style={styles.meterLabel}>{label}</Text>
        <Text style={styles.meterVal}>{limit == null ? `${used} · unlimited` : `${used} / ${limit}`}</Text>
      </View>
      <View style={styles.track}>
        <View style={[styles.fill, { width: `${pct}%`, backgroundColor: pct >= 100 ? colors.flush : colors.hyphae }]} />
      </View>
    </View>
  );
}

export default function Settings() {
  const router = useRouter();
  const { signOut } = useAuth();
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setMe(await api.me());
    setLoading(false);
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  if (loading || !me) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.hyphae} />
      </View>
    );
  }

  return (
    <ScrollView style={{ backgroundColor: colors.spore }} contentContainerStyle={{ padding: 16 }}>
      <View style={styles.card}>
        <Text style={styles.h}>Workspace</Text>
        <Text style={styles.big}>{me.workspace.name}</Text>
        <Text style={styles.muted}>{me.user.email}</Text>
      </View>

      <View style={styles.card}>
        <View style={styles.rowBetween}>
          <Text style={styles.h}>Plan</Text>
          <View style={styles.planBadge}>
            <Text style={styles.planText}>{me.limits.label}</Text>
          </View>
        </View>
        <Meter label="Active batches" used={me.usage.activeBatches} limit={me.limits.maxActiveBatches} />
        <Meter label="Cultures" used={me.usage.cultures} limit={me.limits.maxCultures} />
        <Meter label="Photos" used={me.usage.photos} limit={me.limits.maxPhotos} />
      </View>

      <Text style={styles.api}>API: {API_URL}</Text>

      <TouchableOpacity style={styles.signout} onPress={() => signOut().then(() => router.replace('/login'))}>
        <Text style={styles.signoutText}>Sign out</Text>
      </TouchableOpacity>

      <TouchableOpacity style={styles.credit} onPress={() => Linking.openURL('https://www.dothmen.com')}>
        <Text style={styles.creditText}>
          Built by <Text style={styles.creditLink}>Dothmen Tech</Text>
        </Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.spore },
  card: { backgroundColor: colors.white, borderColor: colors.mycelium, borderWidth: 1, borderRadius: 16, padding: 16, marginBottom: 14 },
  h: { fontSize: 13, fontWeight: '700', color: colors.cap, textTransform: 'uppercase' },
  big: { fontSize: 20, fontWeight: '800', color: colors.substrate, marginTop: 4 },
  muted: { color: colors.ink, opacity: 0.55, marginTop: 2 },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  planBadge: { backgroundColor: '#e2ecd4', borderRadius: 999, paddingVertical: 4, paddingHorizontal: 12 },
  planText: { fontWeight: '700', color: colors.hyphaeDark },
  meterRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 },
  meterLabel: { color: colors.ink, opacity: 0.7 },
  meterVal: { fontWeight: '600', color: colors.substrate },
  track: { height: 8, borderRadius: 999, backgroundColor: colors.mycelium, overflow: 'hidden' },
  fill: { height: '100%', borderRadius: 999 },
  api: { fontSize: 11, color: colors.ink, opacity: 0.4, textAlign: 'center', marginBottom: 20 },
  signout: { alignItems: 'center', padding: 14 },
  signoutText: { color: colors.flush, fontWeight: '700' },
  credit: { alignItems: 'center', paddingVertical: 12 },
  creditText: { fontSize: 12, color: colors.ink, opacity: 0.5 },
  creditLink: { color: colors.hyphaeDark, fontWeight: '700' },
});
