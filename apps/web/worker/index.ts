// Web Worker: serves the built SPA and proxies API calls to the API Worker via a
// service binding, so the browser only ever talks to one origin (cookies stay
// first-party). Static assets are served directly by the runtime; this Worker
// only runs for non-asset paths.
export interface Env {
  ASSETS: { fetch(request: Request): Promise<Response> };
  API: { fetch(request: Request): Promise<Response> };
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/') || url.pathname === '/health') {
      return env.API.fetch(request);
    }
    // Everything else → static assets (with SPA fallback to index.html).
    return env.ASSETS.fetch(request);
  },
};
