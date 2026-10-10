# SPDX-License-Identifier: AGPL-3.0-only
# shellcheck shell=bash
# Shared by failover.sh and migrate-host.sh, sourced, never run: talking to
# the other server (the "peer") over SSH, Postgres streaming replication,
# copying config, secrets, files and the deployed release, the write pause,
# and starting the stack on this server.
#
# Everything privileged goes through Docker (the deploy user is in the docker
# group), so neither server needs sudo except to stop a cloudflared that was
# installed as a system service.

DEPLOY="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
REPO="$(dirname "$DEPLOY")"
STATE="$DEPLOY/standby"
KEY="$STATE/id_ed25519"
KNOWN_HOSTS="$STATE/known_hosts"
PROJECT="${COMPOSE_PROJECT_NAME:-skillpouch}"
PEER_PROJECT="${PEER_PROJECT:-skillpouch}"
TOOLS_IMAGE=alpine:3
SSH_IMAGE=skillpouch/ops-ssh
CLOUDFLARED_READY=http://127.0.0.1:20241/ready
CRON_MARK='# skillpouch-standby-sync'
export COMPOSE_FILE="${SKILLPOUCH_COMPOSE_FILE:-compose.yaml:tunnel/compose.tunnel.yaml}:compose.ops.yaml"
COMPOSE=(docker compose --env-file env/stack.env)
DRY_RUN=0
YES=0
PEER=''
PEER_PORT=22
PEER_DIR=''
ROLE=''

log() { printf '[%s] %s\n' "$TAG" "$*"; }
warn() { printf '[%s] WARNING: %s\n' "$TAG" "$*" >&2; }
die() {
	printf '[%s] ERROR: %s\n' "$TAG" "$*" >&2
	exit 1
}
# A failed check stops a real run; a dry run reports it and goes on.
need() {
	if [ "$DRY_RUN" = 1 ]; then warn "(dry run) a real run stops here: $*"; else die "$*"; fi
}
# Runs a command that changes something, or only prints what it would do.
act() {
	local what=$1
	shift
	if [ "$DRY_RUN" = 1 ]; then
		log "(dry run) would $what"
		return 0
	fi
	log "$what"
	"$@"
}
confirm() {
	if [ "$DRY_RUN" = 1 ]; then
		log "(dry run) would ask: $1"
		return 0
	fi
	[ "$YES" = 1 ] && return 0
	[ -t 0 ] || die "$1 — no terminal to ask on; run again with --yes"
	local answer
	read -r -p "[$TAG] $1 [y/N] " answer
	[[ $answer =~ ^[Yy] ]] || die "stopped"
}
q() { printf '%q' "$1"; }
compose() { (cd "$DEPLOY" && "${COMPOSE[@]}" "$@"); }
lock() {
	mkdir -p "$STATE"
	exec 8>"$STATE/.lock"
	flock -w "${1:-600}" 8
}

# ---------------------------------------------------------------- settings

env_get() { # file name → value ('' when missing)
	[ -f "$1" ] || return 0
	{ grep -E "^$2=" "$1" || true; } | tail -n 1 | cut -d= -f2-
}
data_root() { # as compose sees it: the environment wins over env/stack.env
	local root
	root=${DATA_ROOT:-$(env_get "$DEPLOY/env/stack.env" DATA_ROOT)}
	echo "${root:-/srv/skillpouch}"
}
secrets_dir() { # deploy dir → absolute secrets dir of that checkout
	local dir
	dir=$(env_get "$DEPLOY/env/stack.env" SECRETS_DIR)
	dir=${dir:-./secrets}
	[[ $dir = /* ]] && echo "$dir" || echo "$1/${dir#./}"
}
blob_driver() {
	local driver
	driver=$(env_get "$DEPLOY/env/api.env" BLOB_DRIVER)
	echo "${driver:-fs}"
}
public_host() {
	local host
	host=$(env_get "$DEPLOY/env/stack.env" PUBLIC_HOST)
	echo "${host:-app.skillpouch.net}"
}
load_state() {
	[ -f "$STATE/standby.env" ] || return 1
	PEER=$(env_get "$STATE/standby.env" PEER)
	PEER_PORT=$(env_get "$STATE/standby.env" PEER_PORT)
	PEER_DIR=$(env_get "$STATE/standby.env" PEER_DIR)
	ROLE=$(env_get "$STATE/standby.env" ROLE)
	PEER_PROJECT=$(env_get "$STATE/standby.env" PEER_PROJECT)
	PEER_PROJECT=${PEER_PROJECT:-skillpouch}
	[ -n "$PEER" ]
}
save_state() {
	mkdir -p "$STATE"
	chmod 700 "$STATE"
	(
		umask 077
		printf 'PEER=%s\nPEER_PORT=%s\nPEER_DIR=%s\nPEER_PROJECT=%s\nROLE=%s\n' \
			"$PEER" "$PEER_PORT" "$PEER_DIR" "$PEER_PROJECT" "$ROLE" >"$STATE/standby.env"
	)
}
standby_role() { # replica_<hostname>: the replication login and slot of this server
	local name
	name=$(hostname | tr '[:upper:]' '[:lower:]' | tr -c 'a-z0-9\n' '_' | cut -c1-40)
	echo "replica_${name:-standby}"
}

# ---------------------------------------------------------------- the peer

ssh_base() {
	printf '%s\0' ssh -i "$KEY" -o IdentitiesOnly=yes -o ConnectTimeout=10 \
		-o ServerAliveInterval=15 -o ServerAliveCountMax=4 \
		-o UserKnownHostsFile="$KNOWN_HOSTS" -o StrictHostKeyChecking=accept-new -p "$PEER_PORT"
}
peer() {
	local cmd
	mapfile -d '' cmd < <(ssh_base)
	"${cmd[@]}" -o BatchMode=yes "$PEER" "$@"
}
# Interactive (with a terminal), for a sudo password on the peer.
peer_tty() {
	local cmd
	mapfile -d '' cmd < <(ssh_base)
	"${cmd[@]}" -t "$PEER" "$@"
}
# Shell snippet, evaluated on the peer: the container ids of a compose service.
peer_svc() {
	# shellcheck disable=SC2016 # expanded on the peer
	printf '$(docker ps -q --filter label=com.docker.compose.project=%s --filter label=com.docker.compose.service=%s)' \
		"$PEER_PROJECT" "$1"
}
peer_sql() { # sql [database] → rows
	printf '%s\n' "$1" | peer "docker exec -i $(peer_svc postgres) psql -U postgres -d ${2:-postgres} -XAtq -v ON_ERROR_STOP=1"
}
local_pg() {
	docker ps -q --filter "label=com.docker.compose.project=$PROJECT" \
		--filter label=com.docker.compose.service=postgres | head -n 1
}
local_sql() { # sql [database] → rows
	local pg
	pg=$(local_pg)
	[ -n "$pg" ] || return 1
	printf '%s\n' "$1" | docker exec -i "$pg" psql -U postgres -d "${2:-postgres}" -XAtq -v ON_ERROR_STOP=1
}
# Whether this server has a database of its own (any data in DATA_ROOT/postgres).
local_db_exists() { # data root
	[ -d "$1/postgres" ] || return 1
	[ -n "$(docker run --rm -v "$1/postgres:/d:ro" "$TOOLS_IMAGE" sh -c 'ls -A /d | head -n 1')" ]
}
peer_data_root() {
	local root
	root=$(peer "grep -E '^DATA_ROOT=' $(q "$PEER_DIR/deploy/env/stack.env") | tail -n 1 | cut -d= -f2-" || true)
	echo "${root:-/srv/skillpouch}"
}

ensure_key() {
	mkdir -p "$STATE"
	chmod 700 "$STATE"
	if [ ! -f "$KEY" ]; then
		act "create the SSH key $KEY" ssh-keygen -q -t ed25519 -N '' -C "skillpouch-standby@$(hostname)" -f "$KEY"
	fi
}
check_peer() {
	if ! peer true 2>/dev/null; then
		need "cannot log in to $PEER with $KEY.pub. Authorize it there once, then run again:
    ssh-copy-id -i $KEY.pub -p $PEER_PORT $PEER
  (or append $KEY.pub to ~/.ssh/authorized_keys of that user). The key can use Docker
  there, which is root-equivalent: keep $STATE private."
		return 1
	fi
	peer "docker info >/dev/null 2>&1" || need "$PEER: the SSH user cannot run docker"
	peer "test -f $(q "$PEER_DIR/deploy/compose.yaml")" || need "$PEER: no checkout at $PEER_DIR (use --peer-dir)"
	[ -n "$(peer "echo $(peer_svc postgres)")" ] || need "$PEER: Postgres is not running"
}

# ---------------------------------------------------------------- config and data

# This server's data folders, created through Docker (no sudo).
prepare_data_root() {
	local root
	root=$(data_root)
	docker run --rm -v "$(dirname "$root"):/parent" "$TOOLS_IMAGE" sh -c "
		d=/parent/$(basename "$root")
		mkdir -p \$d/postgres \$d/web/releases \$d/blobs
		chown $(id -u):$(id -g) \$d/web \$d/web/releases
		chown 10001:10001 \$d/blobs && chmod 700 \$d/blobs"
}

fetch_file() { # path in the peer checkout → local file (mode 600)
	local tmp="$2.tmp.$$"
	(
		umask 077
		peer "cat $(q "$PEER_DIR/$1")" >"$tmp"
	)
	mv "$tmp" "$2"
}
fetch_tunnel_token() {
	local token
	token=$(peer "systemctl cat cloudflared 2>/dev/null" | grep -oE -- '--token[= ]+[^ "]+' | head -n 1 | sed -E 's/--token[= ]+//' || true)
	if [ -z "$token" ]; then
		warn "no tunnel token on $PEER. Create $DEPLOY/env/tunnel.env with TUNNEL_TOKEN=<token> (Cloudflare → Zero Trust → Networks → Tunnels → your tunnel → Configure)"
		return 0
	fi
	(
		umask 077
		printf 'TUNNEL_TOKEN=%s\n' "$token" >"$DEPLOY/env/tunnel.env"
	)
}
copy_secrets() {
	local here gid
	here=$(secrets_dir "$DEPLOY")
	gid=$(getent group docker | cut -d: -f3)
	peer "docker run --rm -v $(q "$(peer_secrets_dir)"):/s:ro $TOOLS_IMAGE tar -C /s -cf - ." |
		docker run --rm -i -v "$here:/s" "$TOOLS_IMAGE" sh -c \
			"tar -C /s -xf - && chown -R 10001:${gid:-0} /s && chmod 770 /s && find /s -type f -exec chmod 600 {} +"
}
peer_secrets_dir() {
	local dir
	dir=$(peer "grep -E '^SECRETS_DIR=' $(q "$PEER_DIR/deploy/env/stack.env") | tail -n 1 | cut -d= -f2-" || true)
	dir=${dir:-./secrets}
	[[ $dir = /* ]] && echo "$dir" || echo "$PEER_DIR/deploy/${dir#./}"
}
# env files, the tunnel token and deploy/secrets/: a standby must match the
# primary exactly (same database passwords, same PEPPER_KEY and JWT key).
copy_config() {
	local f
	mkdir -p "$DEPLOY/env"
	for f in stack.env api.env tunnel.env; do
		if peer "test -f $(q "$PEER_DIR/deploy/env/$f")"; then
			act "copy env/$f from $PEER" fetch_file "deploy/env/$f" "$DEPLOY/env/$f"
		fi
	done
	if [ ! -s "$DEPLOY/env/tunnel.env" ]; then
		act "read the Cloudflare Tunnel token from $PEER's cloudflared service" fetch_tunnel_token
	fi
	act "copy deploy/secrets/ from $PEER" copy_secrets
}

blob_list() { # docker volume args… → sorted relative paths of stored files
	docker run --rm "$@" "$TOOLS_IMAGE" sh -c 'cd /b && find . -path ./.tmp -prune -o -type f -print' | LC_ALL=C sort
}
# Files are immutable and content-addressed: copying the ones missing here is
# a complete sync. --prune also deletes files the peer has deleted.
sync_blobs() {
	local prune=${1:-} here there lists missing extra
	if [ "$(blob_driver)" = s3 ]; then
		log "files: BLOB_DRIVER=s3, both servers use the same bucket — nothing to copy"
		return 0
	fi
	here="$(data_root)/blobs"
	there="$(peer_data_root)/blobs"
	lists=$(mktemp -d)
	peer "docker run --rm -v $(q "$there"):/b:ro $TOOLS_IMAGE sh -c 'cd /b && find . -path ./.tmp -prune -o -type f -print'" |
		LC_ALL=C sort >"$lists/there"
	blob_list -v "$here:/b:ro" >"$lists/here"
	LC_ALL=C comm -23 "$lists/there" "$lists/here" >"$lists/missing"
	missing=$(wc -l <"$lists/missing")
	if [ "$missing" -gt 0 ]; then
		act "copy $missing new files from $PEER" copy_blob_list "$there" "$here" "$lists/missing"
	else
		log "files: up to date ($(wc -l <"$lists/here") files)"
	fi
	if [ "$prune" = --prune ]; then
		LC_ALL=C comm -13 "$lists/there" "$lists/here" >"$lists/extra"
		extra=$(wc -l <"$lists/extra")
		if [ "$extra" -gt 0 ] && [ ! -s "$lists/there" ]; then
			warn "$PEER lists no files at all; not pruning $extra files here"
		elif [ "$extra" -gt 0 ]; then
			act "delete $extra files that $PEER no longer has" \
				docker run --rm -i -v "$here:/b" "$TOOLS_IMAGE" sh -c 'cd /b && xargs -r rm -f' <"$lists/extra"
		fi
	fi
	rm -rf "$lists"
}
copy_blob_list() { # there here list
	peer "docker run --rm -i -v $(q "$1"):/b:ro $TOOLS_IMAGE tar -C /b -cf - -T -" <"$3" |
		docker run --rm -i -v "$2:/b" "$TOOLS_IMAGE" sh -c 'tar -C /b -xpf -'
}

# The API image and web release the peer is serving, made available here.
peer_live_image() {
	peer "cd $(q "$PEER_DIR/deploy") && color=\$(cat caddy/.live-color 2>/dev/null || echo blue) &&
		docker inspect -f '{{.Config.Image}}' \$(docker ps -aq --filter label=com.docker.compose.project=$PEER_PROJECT --filter label=com.docker.compose.service=api-\$color | head -n 1) 2>/dev/null"
}
copy_image() { peer "docker save $(q "$1") | gzip -1" | docker load -q; }
build_image() { # commit image
	local dir
	dir=$(mktemp -d)
	git -C "$REPO" fetch --quiet origin main
	git -C "$REPO" archive "$1" | tar -x -C "$dir"
	docker build -q -f "$dir/deploy/docker/api.Dockerfile" -t "$2" "$dir" >/dev/null
	rm -rf "$dir"
}
copy_web_release() { # release name
	local root tmp
	root="$(data_root)/web/releases"
	tmp="$root/.$1.partial"
	rm -rf "$tmp"
	mkdir -p "$tmp"
	peer "tar -C $(q "$(peer_data_root)/web/releases/$1") -cf - ." | tar -C "$tmp" -xf -
	mv -T "$tmp" "$root/$1"
}
link_web_release() {
	local root
	root="$(data_root)/web"
	ln -sfn "releases/$1" "$root/current.new"
	mv -T "$root/current.new" "$root/current"
}
sync_release() {
	local image sha release
	image=$(peer_live_image || true)
	[ -n "$image" ] || {
		warn "$PEER runs no API container; release not copied"
		return 0
	}
	if ! docker image inspect "$image" >/dev/null 2>&1; then
		if [[ $image == */*/* ]]; then
			act "pull $image" docker pull -q "$image"
		elif [ "$(uname -m)" = "$(peer uname -m)" ]; then
			act "copy the image $image from $PEER" copy_image "$image"
		else
			sha=$(peer "cat $(q "$PEER_DIR/deploy/caddy/.deployed")" || true)
			[ -n "$sha" ] || need "$image is not in a registry and $PEER has another CPU architecture; build it here"
			act "build $image for $(uname -m) from commit ${sha:0:12}" build_image "$sha" "$image"
		fi
	fi
	release=$(peer "readlink $(q "$(peer_data_root)/web/current")" || true)
	release=${release#releases/}
	if [ -n "$release" ]; then
		if [ ! -d "$(data_root)/web/releases/$release" ]; then
			act "copy web release $release from $PEER" copy_web_release "$release"
		fi
		if [ "$(readlink "$(data_root)/web/current" 2>/dev/null || true)" != "releases/$release" ]; then
			act "serve web release $release" link_web_release "$release"
		fi
	fi
	if [ "$DRY_RUN" = 0 ]; then
		printf '%s\n' "$image" >"$STATE/image"
		peer "cat $(q "$PEER_DIR/deploy/caddy/.deployed") 2>/dev/null" >"$DEPLOY/caddy/.deployed.tmp" || true
		if [ -s "$DEPLOY/caddy/.deployed.tmp" ]; then
			mv "$DEPLOY/caddy/.deployed.tmp" "$DEPLOY/caddy/.deployed"
		else
			rm -f "$DEPLOY/caddy/.deployed.tmp"
		fi
	fi
}

# ---------------------------------------------------------------- replication

# On the peer: a replication login and slot for this server, a pg_hba line
# for it, and a cap on the WAL the slot may hold back (a standby that stays
# offline must never fill the primary's disk).
prepare_peer_replication() { # password
	peer_sql "DO \$\$ BEGIN
	IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '$ROLE') THEN CREATE ROLE $ROLE; END IF;
END \$\$;
ALTER ROLE $ROLE WITH LOGIN REPLICATION PASSWORD '$1';
SELECT 1 FROM (SELECT pg_create_physical_replication_slot('$ROLE')
	WHERE NOT EXISTS (SELECT FROM pg_replication_slots WHERE slot_name = '$ROLE')) AS created;" >/dev/null
	if [ "$(peer_sql 'SHOW max_slot_wal_keep_size')" = -1 ]; then
		peer_sql "ALTER SYSTEM SET max_slot_wal_keep_size = '${STANDBY_MAX_WAL:-8GB}'" >/dev/null
	fi
	peer "docker exec -i $(peer_svc postgres) sh -s" <<'HBA'
f=$(psql -U postgres -XAtc 'SHOW hba_file')
grep -q '^host replication /\^replica_ ' "$f" || echo 'host replication /^replica_ all scram-sha-256' >>"$f"
HBA
	peer_sql 'SELECT pg_reload_conf()' >/dev/null
}
build_ssh_image() {
	docker image inspect "$SSH_IMAGE" >/dev/null 2>&1 && return 0
	printf 'FROM %s\nRUN apk add --no-cache openssh-client\n' "$TOOLS_IMAGE" | docker build -q -t "$SSH_IMAGE" - >/dev/null
}
start_link() {
	build_ssh_image
	compose --profile standby up -d primary-link
	local _
	for _ in $(seq 1 20); do
		compose run --rm --no-deps -T --entrypoint pg_isready postgres -q -h primary-link -p 5432 2>/dev/null && return 0
		sleep 2
	done
	die "primary-link cannot reach $PEER's Postgres: docker logs ${PROJECT}-primary-link-1"
}
stop_link() {
	compose --profile standby kill primary-link >/dev/null 2>&1 || true
	compose --profile standby rm -f primary-link >/dev/null 2>&1 || true
}
new_password() {
	(
		umask 077
		head -c 32 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | cut -c1-40 >"$1"
	)
}
# Replaces this server's database with a fresh copy of the peer's, which then
# keeps streaming (hot standby, read-only).
base_backup() { # password
	compose stop api-blue api-green worker postgres >/dev/null 2>&1 || true
	compose run --rm --no-deps -T -e PGPASSWORD="$1" -e ROLE="$ROLE" --entrypoint sh postgres -s <<'COPY'
set -eu
D=/var/lib/postgresql/data
find "$D" -mindepth 1 -delete
chown postgres:postgres "$D"
chmod 700 "$D"
as_postgres() { if command -v su-exec >/dev/null; then su-exec postgres "$@"; else gosu postgres "$@"; fi; }
as_postgres pg_basebackup -h primary-link -p 5432 -U "$ROLE" -D "$D" -X stream -R -S "$ROLE" -c fast
# pg_basebackup -R writes the connection without the password.
as_postgres sh -c "echo \"primary_conninfo = 'host=primary-link port=5432 user=$ROLE password=$PGPASSWORD application_name=$ROLE'\" >>$D/postgresql.auto.conf"
COPY
	compose up -d --wait postgres
}
in_recovery() { [ "$(local_sql 'SELECT pg_is_in_recovery()' 2>/dev/null)" = t ]; }
receiver_status() { local_sql 'SELECT status FROM pg_stat_wal_receiver' 2>/dev/null || true; }
wait_for_streaming() {
	local _
	for _ in $(seq 1 30); do
		[ "$(receiver_status)" = streaming ] && return 0
		sleep 1
	done
	return 1
}
# Waits until this server has replayed everything the peer wrote up to $1.
wait_for_replay() { # lsn timeout
	local _
	for _ in $(seq 1 "${2:-30}"); do
		[ "$(local_sql "SELECT pg_last_wal_replay_lsn() >= '$1'::pg_lsn")" = t ] && return 0
		sleep 0.5
	done
	return 1
}
promote() {
	[ "$(local_sql 'SELECT pg_promote(true, 60)')" = t ] || die "Postgres did not finish promotion within 60 s"
}

# ---------------------------------------------------------------- write pause

# The same switch as the admin dashboard's write pause (system_settings,
# cached 2 s by each API instance): mutating requests wait up to 10 s, then
# get a retryable 503 maintenance_write_pause. Reads keep working.
pause_sql() { # true|false
	printf "INSERT INTO system_settings (key, value, updated_at)
VALUES ('maintenance_write_pause', jsonb_build_object('enabled', %s, 'by', '%s', 'at', now()), now())
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now();" "$1" "$TAG"
}
pause_peer() { peer_sql "$(pause_sql "$1")" skillpouch >/dev/null; }
pause_here() { local_sql "$(pause_sql "$1")" skillpouch >/dev/null; }

# ---------------------------------------------------------------- serving

peer_readyz() { peer "curl -fsS --max-time 5 http://127.0.0.1/readyz" >/dev/null 2>&1; }
public_readyz() { curl -fsS --max-time 10 "https://$(public_host)/readyz" >/dev/null 2>&1; }
local_cloudflared_service() { systemctl is-active --quiet cloudflared 2>/dev/null; }

# The API (blue color), worker and Caddy here, with the image the peer served:
# prepare_api creates everything without starting the API (safe on a
# standby, whose read-only database the API cannot boot against).
prepare_api() { # image
	export API_IMAGE="$1" API_IMAGE_BLUE="$1"
	sed -i -E 's/api-(blue|green):8080/api-blue:8080/' "$DEPLOY/caddy/upstreams.caddy"
	echo blue >"$DEPLOY/caddy/.live-color"
	compose up -d --no-deps caddy
	compose exec -T caddy caddy reload --config /etc/caddy/Caddyfile >/dev/null 2>&1 || true
	compose up --no-start --no-deps api-blue worker
}
start_api() { # image
	local _
	prepare_api "$1"
	compose up -d --no-deps api-blue
	for _ in $(seq 1 180); do
		compose exec -T api-blue wget -qO- http://127.0.0.1:8080/readyz >/dev/null 2>&1 && return 0
		sleep 0.5
	done
	die "api-blue did not become ready: compose logs api-blue"
}
start_worker() { compose up -d --no-deps worker; }
start_tunnel() {
	local _
	if local_cloudflared_service; then
		log "cloudflared already runs here as a system service"
		return 0
	fi
	[ -s "$DEPLOY/env/tunnel.env" ] || die "no $DEPLOY/env/tunnel.env (TUNNEL_TOKEN=…)"
	compose --profile cloudflared up -d cloudflared
	for _ in $(seq 1 30); do
		curl -fsS --max-time 2 "$CLOUDFLARED_READY" >/dev/null 2>&1 && return 0
		sleep 1
	done
	die "cloudflared did not connect to Cloudflare: compose logs cloudflared"
}
# Stops the peer from serving: its tunnel connector first (Cloudflare stops
# sending it requests), then its API and worker. Its database is left alone,
# with the write pause still on as a guard.
peer_stop_serving() {
	if peer "systemctl is-active --quiet cloudflared 2>/dev/null"; then
		if peer "sudo -n true" 2>/dev/null; then
			peer "sudo systemctl disable --now cloudflared"
		elif [ -t 0 ]; then
			log "$PEER asks for its sudo password to stop cloudflared"
			peer_tty "sudo systemctl disable --now cloudflared"
		else
			warn "could not stop cloudflared on $PEER (needs sudo): run there 'sudo systemctl disable --now cloudflared'"
			return 1
		fi
	fi
	peer "ids=$(peer_svc cloudflared); [ -z \"\$ids\" ] || docker stop -t 30 \$ids >/dev/null"
	peer "for s in api-blue api-green worker; do ids=\$(docker ps -q --filter label=com.docker.compose.project=$PEER_PROJECT --filter label=com.docker.compose.service=\$s); [ -z \"\$ids\" ] || docker stop -t 30 \$ids >/dev/null; done"
}

install_cron() { # minutes
	command -v crontab >/dev/null || {
		warn "no crontab here: run '$DEPLOY/scripts/failover.sh sync' every few minutes some other way"
		return 0
	}
	{
		crontab -l 2>/dev/null | grep -vF "$CRON_MARK" || true
		echo "*/$1 * * * * $DEPLOY/scripts/failover.sh sync >>$STATE/sync.log 2>&1 $CRON_MARK"
	} | crontab -
}
remove_cron() {
	command -v crontab >/dev/null || return 0
	crontab -l 2>/dev/null | grep -qF "$CRON_MARK" || return 0
	{ crontab -l 2>/dev/null | grep -vF "$CRON_MARK" || true; } | crontab -
}
