// Marketing-site Worker: a pre-launch gate. While SITE_COMING_SOON is "true",
// every visitor sees the Coming Soon splash EXCEPT the platform super admin
// (verified via the API's /api/gate using the shared *.hyphaehub.io session
// cookie). Flip SITE_COMING_SOON off at launch to serve the site to everyone.
export interface Env {
  ASSETS: { fetch(request: Request): Promise<Response> };
  API: { fetch(request: Request): Promise<Response> };
  SITE_COMING_SOON?: string;
}

const SPLASH = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="robots" content="noindex" />
<title>HyphaeHub · Coming soon</title>
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 24px;
    font: 16px/1.6 ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
    color: #2b2420; background: radial-gradient(1200px 600px at 50% -10%, #eef2e6, #f5f1e8); }
  .card { max-width: 560px; text-align: center; }
  .mark { font-size: 54px; line-height: 1; }
  h1 { font-size: 2rem; margin: 18px 0 6px; letter-spacing: -0.02em; }
  h1 .g { color: #4f7a34; }
  .tag { color: #6b5f57; margin: 0 0 26px; }
  .pill { display: inline-block; margin-top: 18px; font-size: .8rem; font-weight: 600; text-transform: uppercase;
    letter-spacing: .08em; color: #4f7a34; background: #e6efd8; border-radius: 999px; padding: 5px 12px; }
  .blurb { color: #4a4038; margin: 22px auto 30px; max-width: 460px; }
  a.btn { display: inline-block; text-decoration: none; font-weight: 600; font-size: .92rem;
    color: #6b5f57; border: 1px solid #ddd5c8; border-radius: 10px; padding: 10px 16px; background: #fff; }
  a.btn:hover { border-color: #4f7a34; color: #4f7a34; }
  .foot { margin-top: 34px; font-size: .8rem; color: #9a8f84; }
  .credit { margin-top: 8px; }
  .credit a { color: #4f7a34; text-decoration: none; font-weight: 600; }
  .credit a:hover { text-decoration: underline; }
</style>
</head>
<body>
  <main class="card">
    <div class="mark">🍄</div>
    <span class="pill">Coming soon</span>
    <h1>Hyphae<span class="g">Hub</span></h1>
    <p class="tag">Track every thread of your grow.</p>
    <p class="blurb">Cultivation lifecycle and cost tracking, built around how you actually grow.
      We are putting the finishing touches on it.</p>
    <a class="btn" href="https://app.hyphaehub.io">Team preview: sign in →</a>
    <p class="foot">Species-agnostic. Follow the laws in your area.</p>
    <p class="foot credit" data-built-by="Dothmen Tech">Built by
      <a href="https://www.dothmen.com" target="_blank" rel="noopener noreferrer">Dothmen Tech</a></p>
  </main>
</body>
</html>`;

// Pages that stay public even while the site is in coming-soon mode, so the
// policies and contact info are always reachable.
const PUBLIC_PATHS = new Set(['/privacy', '/terms', '/legal', '/contact', '/faq']);

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // Canonicalize www → apex (permanent), preserving path + query.
    const url = new URL(request.url);
    if (url.hostname === 'www.hyphaehub.io') {
      url.hostname = 'hyphaehub.io';
      return Response.redirect(url.toString(), 301);
    }

    if (env.SITE_COMING_SOON !== 'true') {
      return env.ASSETS.fetch(request); // launched — serve the real site to everyone
    }

    // Coming-soon mode: policies/contact/FAQ (and site assets) stay public.
    const path = url.pathname.replace(/\/+$/, '') || '/';
    const isPublicAsset =
      url.pathname.startsWith('/_astro/') ||
      url.pathname.startsWith('/assets/') ||
      url.pathname.startsWith('/favicon');
    if (PUBLIC_PATHS.has(path) || isPublicAsset) {
      return env.ASSETS.fetch(request);
    }

    let allowed = false;
    try {
      const res = await env.API.fetch(
        new Request('https://hyphaehub-api.internal/api/gate', {
          headers: { cookie: request.headers.get('cookie') ?? '' },
        }),
      );
      if (res.ok) {
        const data = (await res.json()) as { allowed?: boolean };
        allowed = data.allowed === true;
      }
    } catch {
      allowed = false;
    }
    if (allowed) return env.ASSETS.fetch(request);
    return new Response(SPLASH, {
      status: 200,
      headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
    });
  },
};
