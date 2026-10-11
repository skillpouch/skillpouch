#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-only
# Moves SkillPouch to this server while clients stay connected. Run on the NEW
# server, from its checkout of this repository:
#
#   migrate-host.sh --from user@old-server [--port N] [--peer-dir DIR] [--yes] [--dry-run]
#
# 1. prepare: this server becomes a warm standby of the old one
#    (failover.sh setup: config, secrets, streaming replica, files, release)
# 2. switch, a few seconds:
#    stop the old worker → write pause on → in-flight writes finish → last
#    file copy → replica catches up → promote → start API, worker and a
#    Cloudflare Tunnel connector here (same token) → write pause off
# 3. drain the old server: its tunnel connector, API and worker stop; its
#    database stays as it was, with the write pause still on
#
# Writes wait during the switch (the API holds them up to 10 s, then answers
# a retryable 503 maintenance_write_pause that clients retry); reads keep
# working, SSE clients reconnect and resume from their cursor. If anything
# fails before the promotion, the pause is lifted and the old server carries
# on as if nothing happened. Needs a rehearsal before it is trusted: see
# README.md → "Standby and moving to a new server".
set -euo pipefail
TAG=migrate-host
# shellcheck source=lib/standby.sh
. "$(dirname "$0")/lib/standby.sh"

STAGE=prepare

usage() {
	sed -n '3,16p' "$0" | sed 's/^# \{0,1\}//'
	exit 2
}

now_ms() {
	local us=${EPOCHREALTIME/[.,]/}
	echo $((us / 1000))
}

# Before the promotion every step can be undone: the old server keeps going.
# shellcheck disable=SC2329 # called by the EXIT trap
on_exit() {
	local status=$1
	[ "$status" = 0 ] && return 0
	case "$STAGE" in
	paused)
		warn "the switch failed before the promotion; giving the old server back its writes"
		pause_peer false || warn "could not lift the write pause on $PEER: do it in the admin dashboard (System → write pause)"
		peer "ids=\$(docker ps -aq --filter label=com.docker.compose.project=$PEER_PROJECT --filter label=com.docker.compose.service=worker); [ -z \"\$ids\" ] || docker start \$ids >/dev/null" ||
			warn "could not restart the worker on $PEER"
		warn "$PEER serves as before; this server is still its standby"
		;;
	promoted)
		warn "the switch failed after the promotion: this server's database is the primary now."
		warn "finish by hand: failover.sh promote --force (starts API, worker and tunnel here), then failover.sh fence"
		;;
	esac
}

open_transactions_before() { # timestamp → transactions started before it, still open
	peer_sql "SELECT count(*) FROM pg_stat_activity WHERE datname = 'skillpouch'
		AND backend_type = 'client backend' AND pid <> pg_backend_pid() AND xact_start < '$1'"
}

main() {
	local args=() from='' image lsn paused_at t0 t1 _
	while [ $# -gt 0 ]; do
		case "$1" in
		--from) from="${2:?--from needs user@host}" && shift ;;
		--port | --peer-dir) args+=("$1" "${2:?}") && shift ;;
		--yes) YES=1 && args+=(--yes) ;;
		--dry-run) DRY_RUN=1 && args+=(--dry-run) ;;
		*) usage ;;
		esac
		shift
	done
	[ -n "$from" ] || usage

	log "step 1: make this server a standby of $from"
	"$DEPLOY/scripts/failover.sh" setup --primary "$from" "${args[@]}"
	if ! load_state || [ "$PEER" != "$from" ] || ! peer true 2>/dev/null; then
		[ "$DRY_RUN" = 1 ] || die "this server is not a standby of $from after setup"
		log "(dry run) next: checks, then the switch"
		return 0
	fi
	lock 600 || die "a sync is still running; try again in a minute"

	log "step 2: checks"
	if ! in_recovery || [ "$(receiver_status)" != streaming ]; then
		need "this server is not streaming from $PEER (failover.sh status)"
	fi
	peer_readyz || need "$PEER does not answer on http://127.0.0.1/readyz; for a dead server use failover.sh promote"
	sync_release
	image=$(cat "$STATE/image" 2>/dev/null || true)
	if [ -z "$image" ] || ! docker image inspect "$image" >/dev/null 2>&1; then need "the API image $PEER runs is not here"; fi
	if ! local_cloudflared_service; then
		[ -s "$DEPLOY/env/tunnel.env" ] || need "no $DEPLOY/env/tunnel.env with TUNNEL_TOKEN=… (the token of the tunnel $PEER uses)"
	fi
	if peer "systemctl is-active --quiet cloudflared 2>/dev/null" && ! peer "sudo -n true" 2>/dev/null; then
		[ -t 0 ] || need "cloudflared on $PEER is a system service and sudo there needs a password: run this from a terminal"
		warn "after the switch, $PEER asks for its sudo password to stop cloudflared; until then it still answers part of the requests (writes there get a retryable 503)"
	fi
	sync_blobs
	confirm "Move $(public_host) from $PEER to this server now? Writes pause for a few seconds."

	log "step 3: switch"
	act "pull the cloudflared image" compose --profile cloudflared pull -q cloudflared
	act "start Caddy here and create the API and worker containers" prepare_api "$image"
	if [ "$DRY_RUN" = 1 ]; then
		for _ in "stop the worker on $PEER" "turn on the write pause on $PEER and wait for open writes" \
			"copy the last files" "wait until this server has replayed all of $PEER's WAL" \
			"promote this server's Postgres" "start the API ($image) here" \
			"connect this server to the Cloudflare Tunnel" "turn off the write pause" "start the worker here" \
			"stop $PEER's tunnel connector, API and worker" "copy files uploaded during the switch"; do
			log "(dry run) would $_"
		done
		return 0
	fi

	trap 'on_exit $?' EXIT
	STAGE=paused
	log "stopping the worker on $PEER (its jobs resume here)"
	peer "ids=$(peer_svc worker); [ -z \"\$ids\" ] || docker stop -t 30 \$ids >/dev/null"
	t0=$(now_ms)
	pause_peer true
	paused_at=$(peer_sql 'SELECT now()')
	log "writes paused on $PEER"
	sleep 3 # every API instance re-reads the pause flag within 2 s
	for _ in $(seq 1 40); do
		[ "$(open_transactions_before "$paused_at")" = 0 ] && break
		sleep 0.5
	done
	[ "$(open_transactions_before "$paused_at")" = 0 ] || die "writes from before the pause are still open on $PEER"
	sync_blobs
	lsn=$(peer_sql 'SELECT pg_current_wal_lsn()')
	wait_for_replay "$lsn" 60 || die "this server did not catch up with $PEER (WAL $lsn) within 30 s"
	log "caught up with $PEER at $lsn"
	promote
	STAGE=promoted
	log "promoted; this server's database is the primary"
	start_api "$image"
	start_tunnel
	pause_here false
	t1=$(now_ms)
	STAGE=switched
	log "writes resumed here; they were paused for $(((t1 - t0) / 1000)).$(((t1 - t0) % 1000 / 100)) s"
	start_worker
	stop_link
	remove_cron

	log "step 4: drain $PEER"
	peer_stop_serving || warn "$PEER still has a tunnel connector: stop it there (sudo systemctl disable --now cloudflared)"
	sync_blobs
	curl -fsS --max-time 5 http://127.0.0.1/readyz >/dev/null || warn "http://127.0.0.1/readyz does not answer here"
	if public_readyz; then log "https://$(public_host) answers"; else warn "https://$(public_host)/readyz does not answer"; fi
	cat <<NEXT
[migrate-host] Done: this server serves $(public_host).
  $PEER no longer serves; its database is untouched (write pause on), as a fallback.
  Next:
  1. Deploys: install the GitHub Actions runner here (docs.skillpouch.net/self-hosting/tunnel)
     and remove $PEER's runner, or set up the update timer here.
  2. If cloudflared should run as a system service here instead of the
     container: sudo cloudflared service install <token>, then
     docker compose --profile cloudflared rm -sf cloudflared (in deploy/, same files).
  3. Keep $PEER as a standby of this server for a while (wipes its database):
     there: deploy/scripts/failover.sh setup --primary <this server>
NEXT
}
main "$@"
exit
