# Self-hosting HyphaeHub (Community Edition)

The Community Edition runs the API and web app in a **single container**, backed by a local
SQLite (libSQL) database and local photo storage. No cloud services required.

## Quick start

```bash
cd infra
# edit docker-compose.yml and set BETTER_AUTH_SECRET to a long random value
docker compose up -d
```

Open **http://localhost:8080**, create an account, and start tracking.

Everything (database + photos) lives in the `hyphaehub-data` Docker volume mounted at `/data`.

## How it works

- `apps/api/src/server.node.ts` is the entry point. On boot it:
  1. opens the SQLite database at `DATABASE_URL` (default `file:/data/hyphaehub.db`),
  2. runs the Drizzle migrations from `MIGRATIONS_DIR`,
  3. serves the API under `/api/*` and the built web SPA (`WEB_DIR`) on the same origin.
- Because the web app and API share an origin, auth cookies are first-party — no extra config.

## Configuration

| Variable | Default | Purpose |
|---|---|---|
| `BETTER_AUTH_SECRET` | dev value | **Required in production.** Signs sessions. |
| `PORT` | `8080` | HTTP port |
| `DATABASE_URL` | `file:/data/hyphaehub.db` | libSQL/SQLite URL (a Turso URL also works) |
| `PHOTO_DIR` | `/data/photos` | Where uploaded photos are stored |
| `APP_URL` / `SITE_URL` | localhost | Trusted origins for auth/CORS |
| `BETTER_AUTH_URL` | `http://localhost:$PORT` | Public base URL when behind a domain |

## Behind a domain / TLS

Put the container behind a reverse proxy (Caddy, nginx, Traefik) that terminates TLS and
forwards to port 8080, then set `BETTER_AUTH_URL`, `APP_URL`, and `SITE_URL` to your public
`https://` URL.

## Backups

Back up the `/data` volume (SQLite file + photos). To snapshot:

```bash
docker run --rm -v hyphaehub-data:/data -v "$PWD:/backup" busybox \
  tar czf /backup/hyphaehub-backup.tgz -C /data .
```

## Roadmap

- Cloud access to a self-hosted instance (secure relay) — see [`../ROADMAP.md`](../ROADMAP.md).
- Prebuilt multi-arch images published to a registry.
