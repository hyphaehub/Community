import { useMutation } from '@tanstack/react-query';
import { useMemo } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { LogoMark } from '../components/Logo';
import { Button, Card } from '../components/ui';
import { api } from '../lib/api';
import { PENDING_CONNECT_KEY, useSession } from '../lib/auth';
import { clearConnection } from '../lib/connection';

/** Accept any well-formed http/https origin (http allows LAN/self-host instances). */
function cleanServer(raw: string | null): string | null {
  if (!raw) return null;
  try {
    const u = new URL(raw);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
    return u.origin;
  } catch {
    return null;
  }
}

function clearPending() {
  try {
    sessionStorage.removeItem(PENDING_CONNECT_KEY);
  } catch {
    // best-effort cleanup
  }
}

/**
 * Cloud-side landing for "Connect to Cloud". A self-hosted instance opens
 * `/connect?server=<its origin>` here in a new tab; signed into the cloud, the
 * operator confirms and we record the link with the EXISTING cloud endpoint
 * (`api.connect.register`, which carries the cloud cookie). The self-hosted
 * instance never holds a cloud credential — this is a pure cloud-cookie handoff.
 */
export function Connect() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { data: session, isPending } = useSession();

  // Take the server from the URL, or resume one stashed before sign-in.
  const server = useMemo(() => {
    const fromUrl = cleanServer(params.get('server'));
    if (fromUrl) {
      try {
        sessionStorage.setItem(PENDING_CONNECT_KEY, fromUrl);
      } catch {
        // sessionStorage may be unavailable; the URL param still works this visit.
      }
      return fromUrl;
    }
    try {
      return cleanServer(sessionStorage.getItem(PENDING_CONNECT_KEY));
    } catch {
      return null;
    }
  }, [params]);

  const connect = useMutation({
    mutationFn: async () => {
      const row = await api.connect.register(server as string);
      if (!row)
        throw new Error(
          'Could not record the connection — make sure you are signed in to the cloud.',
        );
      return row;
    },
    onSuccess: clearPending,
  });

  // Sign in to the CLOUD. We may be on an origin whose localStorage is in Cloud
  // Connect mode (bearer → self-host); reset to cloud mode first so the /login
  // route (gated on the connection-aware session) actually renders the cloud
  // login instead of bouncing to the dashboard. The cloud cookie is untouched.
  const signIn = () => {
    clearConnection();
    navigate('/login');
  };

  const cancel = () => {
    clearPending();
    navigate('/');
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-spore px-4">
      <Card className="w-full max-w-md">
        <div className="mb-4 flex items-center gap-2">
          <LogoMark size={28} />
          <span className="text-lg font-semibold text-substrate">Connect to HyphaeHub Cloud</span>
        </div>

        {!server ? (
          <p className="text-sm text-ink/60">
            This link is missing the server address. Open it from your self-hosted instance&rsquo;s
            Settings &rarr; &ldquo;Connect to Cloud&rdquo;.
          </p>
        ) : isPending ? (
          <p className="text-sm text-ink/50">Checking your cloud session&hellip;</p>
        ) : !session ? (
          <>
            <p className="text-sm text-ink/70">
              Sign in to your HyphaeHub Cloud account to connect this server:
            </p>
            <p className="mt-2 break-all rounded-lg border border-mycelium bg-white px-3 py-2 text-xs text-ink">
              {server}
            </p>
            <Button className="mt-4" onClick={signIn}>
              Sign in to continue
            </Button>
          </>
        ) : connect.isSuccess ? (
          <>
            <p className="text-sm text-substrate">
              &#10003; Connected. <strong className="break-all">{server}</strong> is now linked to
              your cloud account.
            </p>
            <p className="mt-2 text-sm text-ink/60">
              Sign in to it from the cloud app&rsquo;s &ldquo;My server&rdquo; tab, and it will
              appear in the platform admin registry.
            </p>
            <Link to="/" className="mt-4 inline-block" onClick={clearPending}>
              <Button variant="secondary">Done</Button>
            </Link>
          </>
        ) : (
          <>
            <p className="text-sm text-ink/70">
              Link this self-hosted instance to your cloud account
              {session.user?.email ? ` (${session.user.email})` : ''}?
            </p>
            <p className="mt-2 break-all rounded-lg border border-mycelium bg-white px-3 py-2 text-xs text-ink">
              {server}
            </p>
            {connect.isError && (
              <p className="mt-2 text-sm text-flush">
                {connect.error instanceof Error ? connect.error.message : 'Could not connect.'}
              </p>
            )}
            <div className="mt-4 flex gap-2">
              <Button onClick={() => connect.mutate()} disabled={connect.isPending}>
                {connect.isPending ? 'Connecting…' : 'Connect this server'}
              </Button>
              <Button variant="secondary" onClick={cancel}>
                Cancel
              </Button>
            </div>
          </>
        )}
      </Card>
    </div>
  );
}
