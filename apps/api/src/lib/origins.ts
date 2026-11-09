/**
 * Origins the OFFICIAL cloud clients are served from. A self-hosted Community
 * Edition instance allows these so the official web app (app.hyphaehub.io) and
 * the store mobile app can connect to it — this is the "Cloud Connect" feature.
 * Self-hosters can add their own (a reverse proxy, a LAN address) via the
 * CONNECT_ORIGINS env (comma-separated).
 */
export const OFFICIAL_CLIENT_ORIGINS = ['https://app.hyphaehub.io'];

/** Official client origins plus any configured via CONNECT_ORIGINS. */
export function connectOrigins(env: { CONNECT_ORIGINS?: string }): string[] {
  const extra = (env.CONNECT_ORIGINS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return [...OFFICIAL_CLIENT_ORIGINS, ...extra];
}
