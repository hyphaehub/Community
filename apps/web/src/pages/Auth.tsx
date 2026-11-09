import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Logo } from '../components/Logo';
import { Button, Card, Field, Input, cn } from '../components/ui';
import { api } from '../lib/api';
import {
  type AuthConfig,
  connectSignIn,
  connectSignUp,
  fetchAuthConfig,
  fetchAuthConfigFor,
  postLoginTarget,
  signIn,
  signInWithAuth0,
  signUp,
} from '../lib/auth';

type Target = 'cloud' | 'connect';

export function Auth() {
  const navigate = useNavigate();
  const [target, setTarget] = useState<Target>('cloud');
  const [cloudConfig, setCloudConfig] = useState<AuthConfig | null>(null);

  // Connect (self-hosted) state
  const [serverUrl, setServerUrl] = useState('');
  const [serverConfig, setServerConfig] = useState<AuthConfig | null>(null);
  const [connected, setConnected] = useState(false);

  // Shared credential form
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetchAuthConfig().then(setCloudConfig);
  }, []);

  const config = target === 'cloud' ? cloudConfig : serverConfig;

  async function auth0() {
    setError(null);
    setBusy(true);
    try {
      const res = await signInWithAuth0(); // redirects to Auth0 on success
      if (res && typeof res === 'object' && 'error' in res && res.error) {
        setError((res.error as { message?: string }).message ?? 'Could not start Auth0 login');
        setBusy(false);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not start Auth0 login');
      setBusy(false);
    }
  }

  async function connectToServer(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const cfg = await fetchAuthConfigFor(serverUrl);
      setServerConfig(cfg);
      setConnected(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not reach that server');
    } finally {
      setBusy(false);
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      if (target === 'connect') {
        if (mode === 'signup') await connectSignUp(serverUrl, name, email, password);
        else await connectSignIn(serverUrl, email, password);
        // Best-effort: record this link on the cloud so the platform admin can
        // see/verify it. No-op if the user isn't signed into the cloud.
        await api.connect.register(serverUrl).catch(() => {});
        window.location.assign('/'); // reload into connect mode
        return;
      }
      const res =
        mode === 'signup'
          ? await signUp.email({ name, email, password })
          : await signIn.email({ email, password });
      if (res.error) setError(res.error.message ?? 'Something went wrong');
      else navigate(postLoginTarget());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setBusy(false);
    }
  }

  const showAuth0 = target === 'cloud' && (config?.auth0Enabled ?? false);
  const showEmail = config?.emailPasswordEnabled ?? true;

  return (
    <div className="flex min-h-screen items-center justify-center bg-spore p-4">
      <div className="w-full max-w-md">
        <div className="mb-6 flex flex-col items-center gap-2 text-center">
          <Logo size={40} />
          <p className="text-sm text-ink/60">Track every thread of your grow.</p>
        </div>
        <Card>
          {/* Cloud vs self-hosted (Cloud Connect) */}
          <div className="mb-5 flex rounded-lg bg-spore p-1 text-sm font-medium">
            {(
              [
                ['cloud', 'HyphaeHub Cloud'],
                ['connect', 'My server'],
              ] as const
            ).map(([t, label]) => (
              <button
                key={t}
                type="button"
                onClick={() => {
                  setTarget(t);
                  setError(null);
                }}
                className={cn(
                  'flex-1 rounded-md px-3 py-1.5 transition-colors',
                  target === t ? 'bg-white text-substrate shadow-sm' : 'text-ink/50',
                )}
              >
                {label}
              </button>
            ))}
          </div>

          {/* Connect: server URL step */}
          {target === 'connect' && !connected && (
            <form onSubmit={connectToServer} className="space-y-4">
              <Field
                label="Your server URL"
                hint="Your self-hosted HyphaeHub, e.g. https://grow.example.com"
              >
                <Input
                  type="url"
                  value={serverUrl}
                  onChange={(e) => setServerUrl(e.target.value)}
                  required
                  placeholder="https://grow.example.com"
                  autoComplete="url"
                />
              </Field>
              {error && <p className="text-sm text-red-600">{error}</p>}
              <Button type="submit" className="w-full" disabled={busy}>
                {busy ? 'Connecting…' : 'Connect'}
              </Button>
              <p className="text-center text-xs text-ink/40">
                Cloud Connect lets the official app use your self-hosted instance.
              </p>
            </form>
          )}

          {/* Auth form (cloud, or connect once a server is reached) */}
          {(target === 'cloud' || connected) && (
            <>
              {target === 'connect' && (
                <p className="mb-4 text-xs text-ink/50">
                  Connected to <span className="font-medium text-substrate">{serverUrl}</span>{' '}
                  <button
                    type="button"
                    className="text-hyphae-700 hover:underline"
                    onClick={() => {
                      setConnected(false);
                      setServerConfig(null);
                    }}
                  >
                    change
                  </button>
                </p>
              )}

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

              {showEmail ? (
                <>
                  <div className="mb-5 flex rounded-lg bg-spore p-1 text-sm font-medium">
                    {(['signin', 'signup'] as const).map((m) => (
                      <button
                        key={m}
                        type="button"
                        onClick={() => setMode(m)}
                        className={cn(
                          'flex-1 rounded-md px-3 py-1.5 transition-colors',
                          mode === m ? 'bg-white text-substrate shadow-sm' : 'text-ink/50',
                        )}
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
              ) : (
                target === 'connect' && (
                  <p className="text-sm text-ink/60">
                    This server uses Auth0 sign-in, which isn't supported from the cloud client yet.
                    Sign in from the server's own web app, or enable email/password on it.
                  </p>
                )
              )}

              {showAuth0 && !showEmail && error && (
                <p className="mt-4 text-sm text-red-600">{error}</p>
              )}
            </>
          )}
        </Card>
        <p className="mt-4 text-center text-xs text-ink/40">
          Species-agnostic. You are responsible for complying with local laws.
        </p>
      </div>
    </div>
  );
}
