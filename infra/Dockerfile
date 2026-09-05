# HyphaeHub Community Edition — single-container self-host.
# Build context is the repo root:  docker build -f infra/Dockerfile .
FROM node:22-bookworm-slim

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable

WORKDIR /app
COPY . .

# Install all deps (build tooling included) and build the shared packages + web SPA.
RUN pnpm install --frozen-lockfile \
  && pnpm --filter @hyphaehub/core build \
  && pnpm --filter @hyphaehub/db build \
  && pnpm --filter @hyphaehub/web build

ENV NODE_ENV=production \
    DATABASE_URL=file:/data/hyphaehub.db \
    PHOTO_DIR=/data/photos \
    MIGRATIONS_DIR=/app/packages/db/drizzle \
    WEB_DIR=/app/apps/web/dist \
    PORT=8080

EXPOSE 8080
VOLUME ["/data"]

# server.node.ts runs migrations on boot and serves API + web on the same origin.
CMD ["pnpm", "--filter", "@hyphaehub/api", "start:node"]
