#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-only
# Switches traffic back to the previous color (still present, stopped). The
# schema is expand-only, so the previous build works against it.
set -euo pipefail
cd "$(dirname "$0")/.."
COMPOSE=(docker compose --env-file env/stack.env)
LIVE="$(cat caddy/.live-color 2>/dev/null || echo blue)"
PREV=$([ "$LIVE" = blue ] && echo green || echo blue)
"${COMPOSE[@]}" start "api-$PREV"
for _ in $(seq 1 30); do
	"${COMPOSE[@]}" exec -T "api-$PREV" wget -qO- http://127.0.0.1:8080/readyz >/dev/null 2>&1 && break
	sleep 1
done
sed -i "s/api-$LIVE:8080/api-$PREV:8080/" caddy/upstreams.caddy
"${COMPOSE[@]}" exec -T caddy caddy reload --config /etc/caddy/Caddyfile
echo "$PREV" > caddy/.live-color
"${COMPOSE[@]}" stop -t 30 "api-$LIVE"
echo "[rollback] live=$PREV"
