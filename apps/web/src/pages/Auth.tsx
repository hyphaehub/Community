import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Logo } from '../components/Logo';
import { Button, Card, Field, Input } from '../components/ui';
import { type AuthConfig, fetchAuthConfig, signIn, signInWithAuth0, signUp } from '../lib/auth';

export function Auth() {
  const navigate = useNavigate();
  const [config, setConfig] = useState<AuthConfig | null>(null);
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetchAuthConfig().then(setConfig);
  }, []);

  async function auth0() {
    setError(null);
    setBusy(true);
    try {
      const res = await signInWithAuth0(); // redirects to Auth0 on success
      if (res && typeof res === 'object' && 'error' in res && res.error) {
        const e = res.error as { message?: string };
        setError(e.message ?? 'Could not start Auth0 login');
        setBusy(false);
      }
      // otherwise the browser is redirecting to Auth0 — leave the button busy
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not start Auth0 login');
      setBusy(false);
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const res =
        mode === 'signup'
          ? await signUp.email({ name, email, password })
          : await signIn.email({ email, password });
      if (res.error) {
        setError(res.error.message ?? 'Something went wrong');
      } else {
        navigate('/');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setBusy(false);
    }
  }

  const showAuth0 = config?.auth0Enabled ?? false;
  const showEmail = config?.emailPasswordEnabled ?? true;

  return (
    <div className="flex min-h-screen items-center justify-center bg-spore p-4">
      <div className="w-full max-w-md">
        <div className="mb-6 flex flex-col items-center gap-2 text-center">
          <Logo size={40} />
          <p className="text-sm text-ink/60">Track every thread of your grow.</p>
        </div>
        <Card>
          {showAuth0 && (
            <>
              <Button type="button" className="w-full" onClick={auth0} disabled={busy}>
                {busy ? 'Please wait…' : 'Continue with Auth0'}
              </Button>
              {showEmail && (
                <div className="my-5 flex items-center gap-3 text-xs text-ink/40">
                  <span className="h-px flex-1 bg-mycelium" />
                  or
                  <span className="h-px flex-1 bg-mycelium" />
                </div>
              )}
            </>
          )}

          {showEmail && (
            <>
              <div className="mb-5 flex rounded-lg bg-spore p-1 text-sm font-medium">
                {(['signin', 'signup'] as const).map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setMode(m)}
                    className={`flex-1 rounded-md px-3 py-1.5 transition-colors ${
                      mode === m ? 'bg-white text-substrate shadow-sm' : 'text-ink/50'
                    }`}
                  >
                    {m === 'signin' ? 'Sign in' : 'Create account'}
                  </button>
                ))}
              </div>

              <form onSubmit={submit} className="space-y-4">
                {mode === 'signup' && (
                  <Field label="Name">
                    <Input value={name} onChange={(e) => setName(e.target.value)} required />
                  </Field>
                )}
                <Field label="Email">
                  <Input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    autoComplete="email"
                  />
                </Field>
                <Field label="Password" hint="At least 8 characters">
                  <Input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    minLength={8}
                    autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
                  />
                </Field>
                {error && <p className="text-sm text-red-600">{error}</p>}
                <Button type="submit" className="w-full" disabled={busy}>
                  {busy ? 'Please wait…' : mode === 'signup' ? 'Create account' : 'Sign in'}
                </Button>
              </form>
            </>
          )}

          {showAuth0 && !showEmail && error && (
            <p className="mt-4 text-sm text-red-600">{error}</p>
          )}
        </Card>
        <p className="mt-4 text-center text-xs text-ink/40">
          Species-agnostic. You are responsible for complying with local laws.
        </p>
      </div>
    </div>
  );
}
