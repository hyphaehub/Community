#!/usr/bin/env bash
#
# Publish the Community Edition to the public hyphaehub/Community repo.
#
# The Community Edition is the self-hostable **web app + API**: apps/web,
# apps/api, packages/core, packages/db, and infra. The marketing site
# (apps/site) and the mobile app (apps/mobile) are cloud/store-only and are
# EXCLUDED. Development happens here in the private monorepo; this script
# publishes a curated mirror and regenerates the lockfile for the reduced
# workspace so `pnpm install --frozen-lockfile` works in CI and the Docker build.
#
# Usage:  bash scripts/publish-community.sh
# Requires: git, pnpm, and push access to the community repo.
set -euo pipefail

REPO_URL="${COMMUNITY_REPO_URL:-https://github.com/hyphaehub/Community.git}"
EXCLUDE=(apps/site apps/mobile)

ROOT="$(git rev-parse --show-toplevel)"
HEAD_SHA="$(git -C "$ROOT" rev-parse --short HEAD)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

echo "→ Cloning $REPO_URL"
git clone -q --depth 1 "$REPO_URL" "$WORK/community"
cd "$WORK/community"

echo "→ Replacing tree with curated monorepo snapshot @ $HEAD_SHA"
git rm -rq --ignore-unmatch '*' >/dev/null
git -C "$ROOT" archive --format=tar HEAD | tar -x -C .
for path in "${EXCLUDE[@]}"; do rm -rf "./$path"; done

echo "→ Regenerating lockfile for the web+api workspace"
pnpm install --lockfile-only

git add -A
if git diff --cached --quiet; then
  echo "→ No changes to publish."
  exit 0
fi
git commit -q -m "Sync Community Edition (web app + API) from monorepo @ ${HEAD_SHA}"
git push -q origin HEAD:main
echo "✓ Published to $REPO_URL"
