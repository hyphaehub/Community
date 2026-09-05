import { Link } from 'expo-router';
import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { api, type Batch } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { colors } from '@/lib/theme';

export default function Batches() {
  const [batches, setBatches] = useState<Batch[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setBatches(await api.batches());
    setLoading(false);
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  async function create() {
    if (!name.trim()) return;
    setBusy(true);
    try {
      await api.createBatch(name.trim());
      setName('');
      setAdding(false);
      await load();
    } catch (e) {
      Alert.alert('Error', e instanceof Error ? e.message : 'Failed');
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.hyphae} />
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.spore }}>
      <View style={styles.addBar}>
        {adding ? (
          <View style={styles.addRow}>
            <TextInput
              style={styles.input}
              placeholder="Batch name"
              value={name}
              onChangeText={setName}
              autoFocus
            />
            <TouchableOpacity style={styles.addBtn} onPress={create} disabled={busy}>
              <Text style={styles.addBtnText}>{busy ? '…' : 'Add'}</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <TouchableOpacity style={styles.newBtn} onPress={() => setAdding(true)}>
            <Text style={styles.newBtnText}>+ New batch</Text>
          </TouchableOpacity>
        )}
      </View>

      <FlatList
        data={batches}
        keyExtractor={(b) => b.id}
        contentContainerStyle={{ padding: 16, paddingTop: 0, gap: 10 }}
        refreshControl={<RefreshControl refreshing={false} onRefresh={load} tintColor={colors.hyphae} />}
        ListEmptyComponent={<Text style={styles.empty}>No batches yet. Add your first run.</Text>}
        renderItem={({ item }) => (
          <Link href={{ pathname: '/batch/[id]', params: { id: item.id } }} asChild>
            <TouchableOpacity style={styles.card}>
              <Text style={styles.cardTitle}>{item.name}</Text>
              <Text style={styles.cardSub}>
                {item.status.toLowerCase()} · started {formatDate(item.startedAt)}
              </Text>
            </TouchableOpacity>
          </Link>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.spore },
  addBar: { padding: 16 },
  addRow: { flexDirection: 'row', gap: 8 },
  input: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.mycelium,
    backgroundColor: colors.white,
    borderRadius: 10,
    padding: 12,
  },
  addBtn: { backgroundColor: colors.hyphaeDark, borderRadius: 10, paddingHorizontal: 18, justifyContent: 'center' },
  addBtnText: { color: colors.spore, fontWeight: '700' },
  newBtn: { backgroundColor: colors.hyphaeDark, borderRadius: 12, padding: 13, alignItems: 'center' },
  newBtnText: { color: colors.spore, fontWeight: '700' },
  card: { backgroundColor: colors.white, borderColor: colors.mycelium, borderWidth: 1, borderRadius: 14, padding: 16 },
  cardTitle: { fontSize: 16, fontWeight: '600', color: colors.substrate },
  cardSub: { fontSize: 12, color: colors.ink, opacity: 0.55, marginTop: 2 },
  empty: { textAlign: 'center', color: colors.ink, opacity: 0.5, marginTop: 40 },
});
