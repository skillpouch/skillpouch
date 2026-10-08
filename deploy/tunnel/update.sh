#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-only
# Builds and deploys the current main branch on this server, if it changed.
#   deploy/tunnel/update.sh            only when origin/main has new commits
#   deploy/tunnel/update.sh --force    rebuild and redeploy now
# Run by the skillpouch-update.timer every 2 minutes.
set -euo pipefail
REPO="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$REPO"
exec 9>/tmp/skillpouch-update.lock
flock -n 9 || { echo "[update] another update is running"; exit 0; }

git fetch --quiet origin main
CURRENT=$(git rev-parse HEAD)
TARGET=$(git rev-parse origin/main)
DEPLOYED=$(cat deploy/caddy/.deployed 2>/dev/null || true)
if [ "${1:-}" != "--force" ] && [ "$TARGET" = "$DEPLOYED" ]; then exit 0; fi
if [ "$CURRENT" != "$TARGET" ]; then
	# The live upstream file is rewritten by deploys; keep it across the checkout.
	cp deploy/caddy/upstreams.caddy /tmp/skillpouch-upstreams.caddy
	git reset --hard --quiet "$TARGET"
	cp /tmp/skillpouch-upstreams.caddy deploy/caddy/upstreams.caddy
fi
SHA=${TARGET:0:12}
DATA_ROOT=$(grep -E '^DATA_ROOT=' deploy/env/stack.env | cut -d= -f2-)
DATA_ROOT=${DATA_ROOT:-/srv/skillpouch}
echo "[update] deploying $SHA"

# 1. API image, built natively for this machine (amd64 or arm64).
docker build -q -f deploy/docker/api.Dockerfile -t "skillpouch/api:$SHA" . >/dev/null

# 2. Web app: build in a throwaway Node container, publish as a new release.
docker run --rm -v "$REPO":/repo -w /repo -e CI=1 node:24-alpine sh -c \
	'corepack enable >/dev/null && pnpm install --frozen-lockfile --filter @skillpouch/web... >/dev/null && pnpm --filter @skillpouch/web build >/dev/null && chown -R '"$(id -u):$(id -g)"' /repo'
mkdir -p "$DATA_ROOT/web/releases"
rm -rf "$DATA_ROOT/web/releases/$SHA"
cp -r apps/web/dist "$DATA_ROOT/web/releases/$SHA"
ln -sfn "releases/$SHA" "$DATA_ROOT/web/current.new" && mv -T "$DATA_ROOT/web/current.new" "$DATA_ROOT/web/current"
# keep the last 5 web releases
ls -1t "$DATA_ROOT/web/releases" | tail -n +6 | xargs -r -I{} rm -rf "$DATA_ROOT/web/releases/{}"

# 3. Zero-downtime API switch (migrations, health check, rollback on failure).
cd deploy
export COMPOSE_FILE=compose.yaml:tunnel/compose.tunnel.yaml SMOKE_URL=http://127.0.0.1/readyz
scripts/deploy.sh "skillpouch/api:$SHA"
echo "$TARGET" > caddy/.deployed
docker image prune -f --filter "until=168h" >/dev/null || true
echo "[update] live: $SHA"
