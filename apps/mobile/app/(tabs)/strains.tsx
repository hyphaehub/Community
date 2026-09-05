import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, FlatList, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { api, type Strain } from '@/lib/api';
import { colors } from '@/lib/theme';

export default function Strains() {
  const [strains, setStrains] = useState<Strain[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setStrains(await api.strains());
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

  return (
    <FlatList
      style={{ backgroundColor: colors.spore }}
      contentContainerStyle={{ padding: 16, gap: 10 }}
      data={strains}
      keyExtractor={(s) => s.id}
      refreshControl={<RefreshControl refreshing={false} onRefresh={load} tintColor={colors.hyphae} />}
      renderItem={({ item }) => (
        <View style={styles.card}>
          <View style={{ flex: 1 }}>
            <Text style={styles.name}>{item.commonName}</Text>
            {item.species ? <Text style={styles.species}>{item.species}</Text> : null}
          </View>
          <View style={[styles.badge, item.isPreset ? styles.preset : styles.custom]}>
            <Text style={styles.badgeText}>{item.isPreset ? 'preset' : 'custom'}</Text>
          </View>
        </View>
      )}
    />
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.spore },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.white,
    borderColor: colors.mycelium,
    borderWidth: 1,
    borderRadius: 14,
    padding: 14,
  },
  name: { fontSize: 15, fontWeight: '600', color: colors.substrate },
  species: { fontSize: 12, fontStyle: 'italic', color: colors.ink, opacity: 0.55, marginTop: 2 },
  badge: { borderRadius: 999, paddingVertical: 4, paddingHorizontal: 10 },
  preset: { backgroundColor: colors.mycelium },
  custom: { backgroundColor: '#e2ecd4' },
  badgeText: { fontSize: 11, fontWeight: '600', color: colors.ink },
});
