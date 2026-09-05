import { useRouter } from 'expo-router';
import { useState } from 'react';
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useAuth } from '@/lib/auth';
import { colors } from '@/lib/theme';

export default function Login() {
  const router = useRouter();
  const { signIn, signUp } = useAuth();
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      if (mode === 'signup') await signUp(name.trim(), email.trim(), password);
      else await signIn(email.trim(), password);
      router.replace('/');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong');
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={styles.container}>
      <Text style={styles.brand}>
        Hyphae<Text style={{ color: colors.hyphae }}>Hub</Text>
      </Text>
      <Text style={styles.title}>Track every thread of your grow.</Text>

      <View style={styles.toggle}>
        {(['signin', 'signup'] as const).map((m) => (
          <TouchableOpacity
            key={m}
            onPress={() => setMode(m)}
            style={[styles.toggleBtn, mode === m && styles.toggleActive]}
          >
            <Text style={[styles.toggleText, mode === m && styles.toggleTextActive]}>
              {m === 'signin' ? 'Sign in' : 'Create account'}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {mode === 'signup' && (
        <TextInput style={styles.input} placeholder="Name" value={name} onChangeText={setName} />
      )}
      <TextInput
        style={styles.input}
        placeholder="Email"
        autoCapitalize="none"
        keyboardType="email-address"
        value={email}
        onChangeText={setEmail}
      />
      <TextInput
        style={styles.input}
        placeholder="Password (min 8 chars)"
        secureTextEntry
        value={password}
        onChangeText={setPassword}
      />
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <TouchableOpacity style={styles.button} onPress={submit} disabled={busy}>
        {busy ? (
          <ActivityIndicator color={colors.spore} />
        ) : (
          <Text style={styles.buttonText}>{mode === 'signup' ? 'Create account' : 'Sign in'}</Text>
        )}
      </TouchableOpacity>
      <Text style={styles.hint}>Species-agnostic. Follow the laws in your area.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 24, justifyContent: 'center', backgroundColor: colors.spore },
  brand: { fontSize: 28, fontWeight: '800', color: colors.substrate, textAlign: 'center' },
  title: { fontSize: 15, color: colors.ink, opacity: 0.6, textAlign: 'center', marginBottom: 24 },
  toggle: { flexDirection: 'row', backgroundColor: colors.mycelium, borderRadius: 12, padding: 4, marginBottom: 20 },
  toggleBtn: { flex: 1, paddingVertical: 8, borderRadius: 9, alignItems: 'center' },
  toggleActive: { backgroundColor: colors.white },
  toggleText: { color: colors.ink, opacity: 0.6, fontWeight: '600', fontSize: 13 },
  toggleTextActive: { color: colors.substrate, opacity: 1 },
  input: {
    borderWidth: 1,
    borderColor: colors.mycelium,
    backgroundColor: colors.white,
    borderRadius: 12,
    padding: 14,
    marginBottom: 12,
    fontSize: 16,
  },
  button: { backgroundColor: colors.hyphaeDark, borderRadius: 12, padding: 15, alignItems: 'center', marginTop: 4 },
  buttonText: { color: colors.spore, fontWeight: '700', fontSize: 16 },
  error: { color: '#b91c1c', marginBottom: 8 },
  hint: { color: colors.ink, opacity: 0.5, textAlign: 'center', marginTop: 16, fontSize: 12 },
});
