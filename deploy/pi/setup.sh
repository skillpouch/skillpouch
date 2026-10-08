#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-only
# One-time setup of a Raspberry Pi (64-bit OS) as a SkillPouch server behind
# Cloudflare Tunnel. Safe to run again: it never overwrites secrets or env files.
#
#   git clone git@github.com:skillpouch/skillpouch.git ~/skillpouch
#   ~/skillpouch/deploy/pi/setup.sh
set -euo pipefail
REPO="$(cd "$(dirname "$0")/../.." && pwd)"
DEPLOY="$REPO/deploy"
DATA_ROOT=/srv/skillpouch
log() { printf '\n[setup] %s\n' "$*"; }

[ "$(uname -m)" = aarch64 ] || { echo "Needs a 64-bit OS (aarch64)."; exit 1; }

log "system updates + basics"
sudo DEBIAN_FRONTEND=noninteractive apt-get update -qq
sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq git curl openssl ca-certificates unattended-upgrades >/dev/null
echo 'APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";' | sudo tee /etc/apt/apt.conf.d/20auto-upgrades >/dev/null

if ! command -v docker >/dev/null; then
	log "installing Docker"
	curl -fsSL https://get.docker.com | sudo sh
fi
sudo usermod -aG docker "$USER"
DOCKER="sudo docker"

if ! command -v cloudflared >/dev/null; then
	log "installing cloudflared"
	curl -fsSL -o /tmp/cloudflared.deb https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-arm64.deb
	sudo dpkg -i /tmp/cloudflared.deb >/dev/null
fi

log "data folders in $DATA_ROOT"
sudo mkdir -p "$DATA_ROOT/postgres" "$DATA_ROOT/web/releases"
sudo install -d -o 10001 -g 10001 -m 700 "$DATA_ROOT/blobs"
sudo chown "$USER" "$DATA_ROOT/web" "$DATA_ROOT/web/releases"

log "secrets (existing files are kept)"
sudo SECRETS_DIR="$DEPLOY/secrets" "$DEPLOY/scripts/init-secrets.sh"

log "env files (existing files are kept)"
if [ ! -f "$DEPLOY/env/stack.env" ]; then
	sed -e "s/^POSTGRES_SUPERUSER_PASSWORD=.*/POSTGRES_SUPERUSER_PASSWORD=$(openssl rand -hex 24)/" \
		-e "s/^POSTGRES_PASSWORD=.*/POSTGRES_PASSWORD=$(openssl rand -hex 24)/" \
		-e "s#^DATA_ROOT=.*#DATA_ROOT=$DATA_ROOT#" \
		"$DEPLOY/env/stack.env.example" > "$DEPLOY/env/stack.env"
	chmod 600 "$DEPLOY/env/stack.env"
fi
if [ ! -f "$DEPLOY/env/api.env" ]; then
	cp "$DEPLOY/env/api.env.example" "$DEPLOY/env/api.env"
	chmod 600 "$DEPLOY/env/api.env"
	echo "  → edit deploy/env/api.env (ADMIN_EMAILS, GitHub/Google OAuth) before going live"
fi

log "starting Postgres and Caddy"
cd "$DEPLOY"
export COMPOSE_FILE=compose.yaml:pi/compose.pi.yaml
$DOCKER compose --env-file env/stack.env up -d --wait postgres
$DOCKER compose --env-file env/stack.env up -d caddy

log "auto-update timer (checks GitHub every 2 minutes)"
sudo tee /etc/systemd/system/skillpouch-update.service >/dev/null <<UNIT
[Unit]
Description=Build and deploy SkillPouch when main changes
After=docker.service network-online.target
Wants=network-online.target

[Service]
Type=oneshot
User=$USER
SupplementaryGroups=docker
ExecStart=$DEPLOY/pi/update.sh
TimeoutStartSec=1h
UNIT
sudo tee /etc/systemd/system/skillpouch-update.timer >/dev/null <<UNIT
[Unit]
Description=Check for new SkillPouch commits

[Timer]
OnBootSec=2min
OnUnitActiveSec=2min

[Install]
WantedBy=timers.target
UNIT
sudo systemctl daemon-reload
sudo systemctl enable --now skillpouch-update.timer

log "first deploy (builds everything; 10–20 min on a Pi)"
sudo -u "$USER" sg docker -c "$DEPLOY/pi/update.sh --force"

cat <<DONE

[setup] Done. SkillPouch answers on http://127.0.0.1 on this Pi.
Next: connect Cloudflare Tunnel (deploy/pi/README.md, step 4).
Follow deploys with:  journalctl -fu skillpouch-update
DONE
