#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-only
# Builds and deploys a commit of main on this server.
#   deploy/tunnel/update.sh                 origin/main, only if it changed
#   deploy/tunnel/update.sh --force         origin/main, rebuild and redeploy now
#   deploy/tunnel/update.sh --ref <sha>     that commit (must be on main), now
# Run by the GitHub Actions deploy workflow (self-hosted runner) or, if
# enabled, the skillpouch-update.timer.
set -euo pipefail
REPO="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$REPO"
exec 9>/tmp/skillpouch-update.lock
flock -w 3600 9 || { echo "[update] another update is still running" >&2; exit 1; }

FORCE=0
REF=origin/main
while [ $# -gt 0 ]; do
	case "$1" in
	--force) FORCE=1 ;;
	--ref) REF="${2:?--ref needs a commit}"; FORCE=1; shift ;;
	*) echo "unknown option: $1" >&2; exit 2 ;;
	esac
	shift
done

git fetch --quiet origin main
CURRENT=$(git rev-parse HEAD)
TARGET=$(git rev-parse --verify --quiet "$REF^{commit}") || { echo "[update] unknown commit $REF" >&2; exit 1; }
# Only commits that are on main can be deployed.
git merge-base --is-ancestor "$TARGET" origin/main || { echo "[update] $REF is not on main" >&2; exit 1; }
DEPLOYED=$(cat deploy/caddy/.deployed 2>/dev/null || true)
if [ "$FORCE" = 0 ] && [ "$TARGET" = "$DEPLOYED" ]; then exit 0; fi
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

# 2. Web app and the static landing page: build in a throwaway Node
# container, publish as a new release (the site goes in its _site/). Hand the
# build output back to us, but never touch deploy/ (secrets are owned by the
# API container user).
docker run --rm -v "$REPO":/repo -w /repo -e CI=1 -e ASTRO_TELEMETRY_DISABLED=1 node:24-alpine sh -c \
	'corepack enable >/dev/null && pnpm install --frozen-lockfile --filter @skillpouch/web... --filter @skillpouch/site... >/dev/null && pnpm --filter @skillpouch/web --filter @skillpouch/site build >/dev/null && find /repo -path /repo/deploy -prune -o -user 0 -exec chown '"$(id -u):$(id -g)"' {} +'
grep -q 'Your AI coding setup' apps/site/dist/index.html || { echo "[update] the landing page build is empty" >&2; exit 1; }
mkdir -p "$DATA_ROOT/web/releases"
rm -rf "$DATA_ROOT/web/releases/$SHA"
cp -r apps/web/dist "$DATA_ROOT/web/releases/$SHA"
cp -r apps/site/dist "$DATA_ROOT/web/releases/$SHA/_site"
ln -sfn "releases/$SHA" "$DATA_ROOT/web/current.new" && mv -T "$DATA_ROOT/web/current.new" "$DATA_ROOT/web/current"
# keep the last 5 web releases
ls -1t "$DATA_ROOT/web/releases" | tail -n +6 | xargs -r -I{} rm -rf "$DATA_ROOT/web/releases/{}"

# 3. Zero-downtime API switch (migrations, health check, rollback on failure).
cd deploy
export COMPOSE_FILE=compose.yaml:tunnel/compose.tunnel.yaml SMOKE_URL=http://127.0.0.1/readyz
# Caddy's Caddyfile is a single-file bind mount, which keeps showing the old
# file after a checkout replaces it: recreate Caddy when the config changed.
if ! docker compose --env-file env/stack.env exec -T caddy cat /etc/caddy/Caddyfile | cmp -s - tunnel/Caddyfile; then
	echo "[update] Caddyfile changed, recreating caddy"
	docker compose --env-file env/stack.env up -d --no-deps --force-recreate caddy
fi
scripts/deploy.sh "skillpouch/api:$SHA"
echo "$TARGET" > caddy/.deployed
# Keep the 3 newest API images (live + the previous color for rollback + one
# spare); older ones, dangling layers and stale build cache go.
docker image ls skillpouch/api --format '{{.CreatedAt}}\t{{.Repository}}:{{.Tag}}' \
	| sort -r | tail -n +4 | cut -f2 | xargs -r docker image rm >/dev/null 2>&1 || true
docker image prune -f >/dev/null || true
docker builder prune -f --filter "until=168h" >/dev/null || true
echo "[update] live: $SHA"
