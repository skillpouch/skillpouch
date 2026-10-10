#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-only
# One-time setup of any Linux server (Debian/Ubuntu/Raspberry Pi OS, x86_64 or
# arm64) as a SkillPouch server behind Cloudflare Tunnel. Safe to run again: it never overwrites secrets or env files.
#
#   git clone git@github.com:skillpouch/skillpouch.git ~/skillpouch
#   ~/skillpouch/deploy/tunnel/setup.sh                    (deploys via GitHub Actions)
#   AUTO_UPDATE=timer ~/skillpouch/deploy/tunnel/setup.sh  (polls GitHub every 2 min)
set -euo pipefail
REPO="$(cd "$(dirname "$0")/../.." && pwd)"
DEPLOY="$REPO/deploy"
DATA_ROOT=/srv/skillpouch
log() { printf '\n[setup] %s\n' "$*"; }

ARCH=$(dpkg --print-architecture)
case "$ARCH" in amd64 | arm64) ;; *) echo "Needs a 64-bit OS (amd64 or arm64), got $ARCH."; exit 1 ;; esac

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
	curl -fsSL -o /tmp/cloudflared.deb https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-$ARCH.deb
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
# Explicit -f flags: sudo drops COMPOSE_FILE from the environment.
COMPOSE=($DOCKER compose -f compose.yaml -f tunnel/compose.tunnel.yaml --env-file env/stack.env)
"${COMPOSE[@]}" up -d --wait postgres
"${COMPOSE[@]}" up -d --force-recreate caddy

# Deploys come from the GitHub Actions workflow (self-hosted runner, after CI
# passes). `AUTO_UPDATE=timer` instead polls GitHub every 2 minutes.
if [ "${AUTO_UPDATE:-actions}" = timer ]; then
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
ExecStart=$DEPLOY/tunnel/update.sh
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
else
	sudo systemctl disable --now skillpouch-update.timer 2>/dev/null || true
	echo "  → deploys come from GitHub Actions: install the runner (deploy/tunnel/README.md)"
fi

RUNNER_DIR="$HOME/actions-runner"
if [ "${AUTO_UPDATE:-actions}" != timer ] && [ ! -x "$RUNNER_DIR/config.sh" ]; then
	log "downloading the GitHub Actions runner for $ARCH"
	RUNNER_ARCH=$([ "$ARCH" = amd64 ] && echo x64 || echo arm64)
	RUNNER_VERSION=$(curl -fsSL https://api.github.com/repos/actions/runner/releases/latest \
		| grep -m1 '"tag_name"' | sed -E 's/.*"v([^"]+)".*/\1/')
	mkdir -p "$RUNNER_DIR"
	curl -fsSL "https://github.com/actions/runner/releases/download/v$RUNNER_VERSION/actions-runner-linux-$RUNNER_ARCH-$RUNNER_VERSION.tar.gz" \
		| tar xz -C "$RUNNER_DIR"
fi

log "first deploy (builds everything; a few minutes, 10–20 on a Pi)"
sudo -u "$USER" sg docker -c "$DEPLOY/tunnel/update.sh --force"

cat <<DONE

[setup] Done. SkillPouch answers on http://127.0.0.1 on this server.

Next steps
----------
1. Back up deploy/secrets/pepper_key and deploy/secrets/jwt_signing_key offline.

2. Settings: edit $DEPLOY/env/api.env (ADMIN_EMAILS, GITHUB_CLIENT_ID, ...),
   put OAuth secrets in $DEPLOY/secrets/, then: sudo chown 10001:docker $DEPLOY/secrets/*

3. Cloudflare Tunnel: Zero Trust -> Networks -> Tunnels -> Create -> Cloudflared,
   run the 'sudo cloudflared service install <token>' command it shows here, and
   add the public hostname  app.skillpouch.net -> HTTP -> localhost:80
DONE

if [ "${AUTO_UPDATE:-actions}" = timer ]; then
	echo "4. Deploys: the timer checks GitHub every 2 minutes (journalctl -fu skillpouch-update)."
else
	cat <<DONE

4. Deploys (GitHub Actions runner, already downloaded to $RUNNER_DIR):
   a. GitHub -> skillpouch/skillpouch -> Settings -> Actions -> Runners ->
      New self-hosted runner, and copy only the token from its "Configure" step.
   b. Run here:
        cd $RUNNER_DIR
        ./config.sh --url https://github.com/skillpouch/skillpouch --token <TOKEN> \\
          --name "\$(hostname)" --labels skillpouch-server --unattended
        sudo ./svc.sh install && sudo ./svc.sh start
   c. Check: the runner shows "Idle" on that GitHub page. Test with
      Actions -> deploy -> Run workflow.
DONE
fi
