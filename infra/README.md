# Self-hosting HyphaeHub (Community Edition)

The Community Edition runs the API and web app in a **single container**, backed by a local
SQLite (libSQL) database and local photo storage. No cloud services required.

## Quick start

```bash
cd infra
docker compose up -d
```

Open **http://localhost:8080**, create an account, and start tracking. That's it — no
config to edit. On first boot a strong session secret is generated and saved inside the
data volume (set `BETTER_AUTH_SECRET` yourself only if you want to pin it; see below).

To run on a different host port:

```bash
HTTP_PORT=9000 docker compose up -d   # now at http://localhost:9000
```

Everything (database, photos, and the generated auth secret) lives in the `hyphaehub-data`
Docker volume mounted at `/data`.

## Verify your install

A dependency-free end-to-end smoke test drives a running instance through the whole
lifecycle (sign up → farm → strain → grain jars → bulk tub → harvest → cost/yield rollup),
checks tenant isolation, and exercises the **Cloud Connect** cross-origin path (the official
cloud app talking to your server with bearer auth). Point it at your instance:

```bash
BASE_URL=http://localhost:8080 node scripts/e2e-selfhost.mjs
# or, from the repo root:  pnpm e2e:selfhost
```

It prints a pass/fail line per check and exits non-zero if anything fails.

## How it works

- `apps/api/src/server.node.ts` is the entry point. On boot it:
  1. opens the SQLite database at `DATABASE_URL` (default `file:/data/hyphaehub.db`),
  2. runs the Drizzle migrations from `MIGRATIONS_DIR`,
  3. serves the API under `/api/*` and the built web SPA (`WEB_DIR`) on the same origin.
- Because the web app and API share an origin, auth cookies are first-party — no extra config.

## Configuration

| Variable | Default | Purpose |
|---|---|---|
| `BETTER_AUTH_SECRET` | auto-generated | Signs sessions. If unset (or left as a placeholder) a strong secret is generated on first boot and persisted to `/data/.auth-secret`. Set it to pin your own value or share one across replicas. |
| `HTTP_PORT` | `8080` | Host port published by docker compose (maps to container `8080`). |
| `PORT` | `8080` | Port the server listens on **inside** the container. |
| `DATABASE_URL` | `file:/data/hyphaehub.db` | libSQL/SQLite URL (a Turso URL also works) |
| `PHOTO_DIR` | `/data/photos` | Where uploaded photos are stored |
| `APP_URL` / `SITE_URL` | `http://localhost:$HTTP_PORT` | Trusted origins for auth/CORS |
| `BETTER_AUTH_URL` | `APP_URL` | Public base URL when behind a domain |
| `CONNECT_ORIGINS` | — | Extra client origins allowed to connect (comma-separated). The official cloud apps are always allowed. |
| `HYPHAEHUB_TELEMETRY` | on | Anonymous install telemetry (see [Telemetry](#telemetry)). Set to `off` to disable. |
| `HYPHAEHUB_TELEMETRY_URL` | official cloud | Where the anonymous ping is sent (override to point at your own collector). |
| `HYPHAEHUB_DOMAIN` | — | Public hostname for the Caddy proxy (`docker-compose.proxy.yml`) or the Cloudflare Tunnel (`docker-compose.tunnel.yml`) overlays. |
| `TUNNEL_TOKEN` | — | Cloudflare Tunnel connector token, used only by `docker-compose.tunnel.yml`. |

## Behind a domain / TLS (one command)

A ready-made Caddy front door is included (`Caddyfile` + `docker-compose.proxy.yml`). It
terminates TLS, obtains and renews a **Let's Encrypt** certificate automatically, and sets
`APP_URL` / `SITE_URL` / `BETTER_AUTH_URL` to your public URL for you. Point your domain's
DNS at this host (ports 80 + 443 must be reachable), then:

```bash
cd infra
HYPHAEHUB_DOMAIN=grow.example.com \
  docker compose -f docker-compose.yml -f docker-compose.proxy.yml up -d
```

HyphaeHub is now at `https://grow.example.com`. (Prefer your own proxy — nginx, Traefik —
instead? Terminate TLS there, forward to the app's port `8080`, and set `APP_URL`,
`SITE_URL`, and `BETTER_AUTH_URL` to your `https://` URL.)

## Behind a dynamic IP / no port forwarding (Cloudflare Tunnel)

Self-hosting at home — a **dynamic residential IP**, **CGNAT**, or a router you can't
port-forward? Then you can't open ports 80/443, so the Caddy proxy above can't reach you. A
**Cloudflare Tunnel** solves all of it at once: `cloudflared` makes an **outbound-only**
connection to Cloudflare, which gives you a **stable public HTTPS hostname** and forwards
traffic back down the tunnel. No inbound ports, no static IP, and TLS is handled for you —
and because Cloud Connect registers the *hostname* (not your IP), a changing IP never breaks
the link.

One-time setup in the Cloudflare dashboard (**Zero Trust → Networks → Tunnels**):

1. **Create a tunnel** and copy its connector **token**.
2. On the tunnel's **Public Hostname** tab, add a route: your hostname (e.g.
   `grow.example.com`) → **Service** `HTTP` `http://hyphaehub:8080`. The domain must be on
   your Cloudflare account (Cloudflare owns its DNS, so your origin IP is irrelevant and
   never needs to be stable).

Then run it (from `infra/`):

```bash
TUNNEL_TOKEN=eyJhbGci... HYPHAEHUB_DOMAIN=grow.example.com \
  docker compose -f docker-compose.yml -f docker-compose.tunnel.yml up -d
```

HyphaeHub is now reachable at `https://grow.example.com` with **no ports opened on your
router**. Register that URL for Cloud Connect (Settings → **Connect to Cloud**, or the cloud
app's **“My server”** sign-in) — it stays valid through every IP change.

## Backups

Back up the `/data` volume (SQLite file + photos). To snapshot:

```bash
docker run --rm -v hyphaehub-data:/data -v "$PWD:/backup" busybox \
  tar czf /backup/hyphaehub-backup.tgz -C /data .
```

## Move your data in or out (cloud ↔ self-host)

You can move a whole workspace between the cloud and a self-hosted instance in
either direction — the export/import endpoints are identical on both, so there is
no lock-in. An export is a single portable JSON archive containing every row
(strains, batches, the lineage graph, events, harvests, costs, inventory) **and
the photo bytes**; an import ingests it into a brand-new workspace you own, with
all ids remapped (your existing data is never touched).

```bash
# 1. On the SOURCE (cloud or self-host): export your active workspace.
#    Sign in there and use an owner/admin session token.
curl -fsS https://app.hyphaehub.io/api/transfer/export \
  -H "authorization: Bearer <TOKEN>" -H "x-workspace-id: <WORKSPACE_ID>" \
  -o hyphaehub-export.json

# 2. On the DESTINATION (e.g. this self-host): import it into a new workspace.
curl -fsS http://localhost:8080/api/transfer/import \
  -H "authorization: Bearer <TOKEN>" -H "content-type: application/json" \
  --data-binary @hyphaehub-export.json
# → { "workspaceId": "...", "counts": { "cultures": 6, "photos": 1, ... } }
```

`GET /api/transfer/export?photos=0` skips the photo bytes for a smaller,
metadata-only archive. The round-trip is covered by `pnpm e2e:transfer`.

## Cloud Connect (use the official apps with your data)

The official cloud web app (`app.hyphaehub.io`) and the mobile app can talk **directly** to your
self-hosted instance — your data never passes through our cloud (it's a cross-origin connection with
bearer auth, not a relay). To use it:

1. Expose this container over HTTPS. If you have a domain and can open ports 80/443, the
   simplest way is the bundled Caddy proxy (see
   [Behind a domain / TLS](#behind-a-domain--tls-one-command)); on a **dynamic IP or behind
   CGNAT / no port forwarding**, use the
   [Cloudflare Tunnel](#behind-a-dynamic-ip--no-port-forwarding-cloudflare-tunnel) instead.
   Either one sets `APP_URL` + `BETTER_AUTH_URL` to your public URL for you.
2. In the cloud web app or the mobile app, choose **“My server”** and enter your URL, then sign in.

Your instance already trusts the official apps (`app.hyphaehub.io` + the mobile app); add any other
client origins via `CONNECT_ORIGINS`. Cloud Connect is offered as the paid **Connect** plan on the
cloud side.

## Telemetry

To understand how many people actually run the Community Edition, each instance sends a tiny,
**anonymous** ping on startup and once a day. It contains only:

- a random **install id** generated on first boot and kept in your data volume (`/data/.install-id`);
- the **version** you're running;
- the edition (`community`).

That's it — **no account, no personal data, no usage contents, and the receiver does not store your
IP**. It's just a counter of running installs. To turn it off completely:

```yaml
environment:
  HYPHAEHUB_TELEMETRY: "off"
```

You can also point it at your own collector with `HYPHAEHUB_TELEMETRY_URL`.

## Roadmap

- Prebuilt multi-arch images published to a registry.
