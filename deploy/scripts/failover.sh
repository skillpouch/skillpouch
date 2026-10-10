#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-only
# Warm standby on a second server, and taking over when the primary dies.
# Run on the STANDBY server, from its checkout of this repository:
#
#   failover.sh setup --primary user@host   make this server a warm standby
#   failover.sh sync [--prune]              copy new files, config and the live release (cron, every 5 min)
#   failover.sh status                      replication lag, last sync, what serves
#   failover.sh promote                     the primary is gone: this server takes over
#   failover.sh fence [--host user@host]    stop the old primary from serving again
#
# Options: --yes (don't ask), --dry-run (run the checks, print the changes).
# setup: --port N (SSH port), --peer-dir DIR (checkout on the primary; default:
# the same path as here), --every MIN (sync interval, default 5), --rebuild
# (copy the database again even if it is already streaming),
# --replace-local-database (allow replacing a database here that has accounts).
# promote: --force (take over although the primary still answers; it is
# stopped first if reachable).
#
# The standby's Postgres streams the primary's WAL through an SSH link
# (compose.ops.yaml → primary-link); files are copied every few minutes
# (nothing to copy with BLOB_DRIVER=s3); config and secrets mirror the
# primary's. Promotion starts the API with the release the primary ran and a
# Cloudflare Tunnel connector with the same token. Needs a rehearsal before
# it is trusted: see README.md → "Standby and moving to a new server".
set -euo pipefail
TAG=failover
# shellcheck source=lib/standby.sh
. "$(dirname "$0")/lib/standby.sh"

usage() {
	sed -n '3,18p' "$0" | sed 's/^# \{0,1\}//'
	exit 2
}

cmd_setup() {
	local every=5 rebuild=0 replace=0 password
	while [ $# -gt 0 ]; do
		case "$1" in
		--primary) PEER="${2:?--primary needs user@host}" && shift ;;
		--port) PEER_PORT="${2:?}" && shift ;;
		--peer-dir) PEER_DIR="${2:?}" && shift ;;
		--every) every="${2:?}" && shift ;;
		--rebuild) rebuild=1 ;;
		--replace-local-database) replace=1 ;;
		--yes) YES=1 ;;
		--dry-run) DRY_RUN=1 ;;
		*) usage ;;
		esac
		shift
	done
	if [ -z "$PEER" ]; then load_state || die "setup needs --primary user@host"; fi
	PEER_DIR=${PEER_DIR:-$REPO}
	ROLE=${ROLE:-$(standby_role)}
	lock

	ensure_key
	[ "$DRY_RUN" = 1 ] || save_state
	check_peer || {
		log "(dry run) next: copy config and secrets, set up replication, copy the database, files and release, sync every $every min"
		return 0
	}
	[ "$(peer_sql 'SHOW wal_level')" != minimal ] || need "$PEER: wal_level is minimal; streaming needs replica"

	if local_cloudflared_service; then
		need "cloudflared runs on this server as a system service, so it serves users. A standby must not: sudo systemctl disable --now cloudflared"
	fi
	if systemctl is-active --quiet skillpouch-update.timer 2>/dev/null; then
		need "skillpouch-update.timer deploys on this server; a standby must not: sudo systemctl disable --now skillpouch-update.timer"
	fi

	local root streaming=0 accounts
	root=${DATA_ROOT:-$(env_get "$DEPLOY/env/stack.env" DATA_ROOT)}
	root=${root:-$(peer_data_root)}
	if [ -n "$(local_pg)" ] && ! in_recovery; then
		accounts=$(local_sql 'SELECT count(*) FROM users' skillpouch 2>/dev/null || echo 0)
		if [ "${accounts:-0}" -gt 0 ] && [ "$replace" = 0 ]; then
			die "this server's database is a primary with $accounts accounts (promoted, or serving on its own). Refusing to replace it; --replace-local-database overrides"
		fi
	fi
	if [ "$rebuild" = 0 ] && in_recovery && [ "$(receiver_status)" = streaming ]; then
		streaming=1
		log "this server already streams from $PEER"
	elif local_db_exists "$root"; then
		confirm "This server has a database of its own in $root/postgres. Replace it, its config and its secrets with copies from $PEER?"
	fi

	copy_config
	act "create the data folders in $root" prepare_data_root
	if [ ! -s "$STATE/replication_password" ]; then
		act "create a replication password" new_password "$STATE/replication_password"
	fi
	password=$(cat "$STATE/replication_password" 2>/dev/null || echo dry-run)
	act "set up replication on $PEER (login and slot $ROLE, pg_hba, WAL cap ${STANDBY_MAX_WAL:-8GB})" \
		prepare_peer_replication "$password"
	act "start the SSH link to $PEER's Postgres (primary-link)" start_link
	if [ "$streaming" = 0 ]; then
		act "copy $PEER's database here (pg_basebackup; minutes for a large database)" base_backup "$password"
		if [ "$DRY_RUN" = 0 ]; then wait_for_streaming || die "the copy is not streaming: compose logs postgres"; fi
	fi
	act "start Caddy (it serves nothing until a tunnel connector runs here)" compose up -d --no-deps caddy
	sync_release
	sync_blobs
	[ "$DRY_RUN" = 1 ] || date -u +%FT%TZ >"$STATE/last-sync"
	act "sync every $every minutes (crontab)" install_cron "$every"
	[ "$DRY_RUN" = 1 ] || cmd_status
	log "standby ready. Rehearse a failover before relying on it (README.md)."
}

cmd_sync() {
	local prune=''
	while [ $# -gt 0 ]; do
		case "$1" in
		--prune) prune=--prune ;;
		--dry-run) DRY_RUN=1 ;;
		*) usage ;;
		esac
		shift
	done
	load_state || die "not a standby: run failover.sh setup first"
	lock 0 || {
		log "another sync or switch is running"
		return 0
	}
	if [ -n "$(local_pg)" ] && ! in_recovery; then
		log "this server is no longer a standby (promoted); removing the sync job"
		remove_cron
		return 0
	fi
	peer true 2>/dev/null || die "$(date -u +%FT%TZ) cannot reach $PEER"
	copy_config
	sync_release
	sync_blobs "$prune"
	if [ "$DRY_RUN" = 0 ]; then
		date -u +%FT%TZ >"$STATE/last-sync"
		# keep the cron log small
		if [ -f "$STATE/sync.log" ] && [ "$(wc -c <"$STATE/sync.log")" -gt 1048576 ]; then
			tail -n 2000 "$STATE/sync.log" >"$STATE/sync.log.tmp" && mv "$STATE/sync.log.tmp" "$STATE/sync.log"
		fi
	fi
}

cmd_status() {
	load_state || die "not a standby: run failover.sh setup first"
	local lsn
	printf 'primary          %s (%s)\n' "$PEER" "$PEER_DIR"
	if [ -z "$(local_pg)" ]; then
		printf 'this server      Postgres is not running\n'
	elif in_recovery; then
		printf 'this server      standby, WAL receiver: %s\n' "$(receiver_status)"
		printf 'last replayed    %s\n' "$(local_sql "SELECT coalesce(date_trunc('second', now() - pg_last_xact_replay_timestamp())::text || ' ago', 'nothing since the copy')")"
	else
		printf 'this server      PRIMARY (promoted)\n'
	fi
	if peer true 2>/dev/null; then
		lsn=$(peer_sql 'SELECT pg_current_wal_lsn()' || true)
		if [ -n "$lsn" ] && in_recovery; then
			printf 'behind primary   %s bytes of WAL\n' "$(local_sql "SELECT pg_wal_lsn_diff('$lsn', pg_last_wal_replay_lsn())")"
		fi
		printf 'slot on primary  %s\n' "$(peer_sql "SELECT 'wal ' || wal_status || ', ' || CASE WHEN active THEN 'connected' ELSE 'not connected' END FROM pg_replication_slots WHERE slot_name = '$ROLE'" || echo unknown)"
		printf 'primary serves   %s\n' "$(peer_readyz && echo yes || echo NO)"
	else
		printf 'primary          UNREACHABLE over SSH\n'
	fi
	printf 'public %s  %s\n' "$(public_host)" "$(public_readyz && echo answers || echo 'DOES NOT ANSWER')"
	printf 'last file sync   %s\n' "$(cat "$STATE/last-sync" 2>/dev/null || echo never)"
	printf 'release          %s\n' "$(cat "$STATE/image" 2>/dev/null || echo none)"
	printf 'sync job         %s\n' "$(crontab -l 2>/dev/null | grep -qF "$CRON_MARK" && echo installed || echo none)"
}

cmd_promote() {
	local force=0 image peer_up=0
	while [ $# -gt 0 ]; do
		case "$1" in
		--force) force=1 ;;
		--yes) YES=1 ;;
		--dry-run) DRY_RUN=1 ;;
		*) usage ;;
		esac
		shift
	done
	load_state || die "not a standby: run failover.sh setup first"
	lock 60 || warn "a sync is still running; promoting anyway"
	[ -n "$(local_pg)" ] || die "Postgres is not running here: compose up -d postgres"

	if peer true 2>/dev/null; then peer_up=1; fi
	if [ "$peer_up" = 1 ] && peer_readyz; then
		[ "$force" = 1 ] || need "$PEER still serves. For a planned move use migrate-host.sh; --force takes over anyway (the primary is stopped first)"
	elif [ "$peer_up" = 0 ] && public_readyz; then
		[ "$force" = 1 ] || need "$PEER is unreachable over SSH, but https://$(public_host) still answers — the primary may still be serving. Taking over now risks two servers accepting writes. Check, then use --force"
	fi
	if in_recovery; then
		log "data: last transaction replayed $(local_sql "SELECT coalesce(date_trunc('second', now() - pg_last_xact_replay_timestamp())::text || ' ago', 'never')"); files synced $(cat "$STATE/last-sync" 2>/dev/null || echo never)"
	fi
	image=$(cat "$STATE/image" 2>/dev/null || true)
	if [ -z "$image" ] || ! docker image inspect "$image" >/dev/null 2>&1; then
		need "no API image recorded here (failover.sh sync copies it); after promotion deploy with deploy/tunnel/update.sh --force"
	fi
	confirm "Promote this server to primary and serve $(public_host) from here?"

	if [ "$peer_up" = 1 ]; then
		act "stop $PEER from serving (tunnel connector, API, worker)" peer_stop_serving || warn "could not fully stop $PEER"
		act "turn on the write pause in $PEER's database (guard against a restart there)" pause_peer true || true
	fi
	if in_recovery; then
		act "promote this server's Postgres" promote
	else
		log "Postgres here is already the primary"
	fi
	act "stop the link to the old primary" stop_link
	act "remove the sync job" remove_cron
	act "make sure writes are not paused" pause_here false
	if [ -n "$image" ]; then
		act "start the API ($image) and Caddy" start_api "$image"
		act "start the worker" start_worker
	fi
	act "connect this server to the Cloudflare Tunnel" start_tunnel
	if [ "$DRY_RUN" = 0 ]; then
		curl -fsS --max-time 5 http://127.0.0.1/readyz >/dev/null || warn "http://127.0.0.1/readyz does not answer here"
		if public_readyz; then log "https://$(public_host) answers"; else warn "https://$(public_host)/readyz does not answer yet"; fi
	fi
	[ "$DRY_RUN" = 1 ] && return 0
	cat <<NEXT
[failover] This server is the primary now.
  1. Keep the old server ($PEER) from serving when it comes back: it would
     reconnect to the same tunnel with old data. Before it rejoins a network,
     or as soon as SSH works: deploy/scripts/failover.sh fence --host $PEER
     The surest fence: create a new tunnel in Cloudflare, move the public
     hostname to it and put its token in deploy/env/tunnel.env here.
  2. Deploys: install the GitHub Actions runner here (deploy/tunnel/README.md §5)
     and remove the old server's runner.
  3. Set up a new standby, e.g. the old server once repaired:
     there: deploy/scripts/failover.sh setup --primary <this server>
NEXT
}

cmd_fence() {
	while [ $# -gt 0 ]; do
		case "$1" in
		--host) PEER="${2:?}" && shift ;;
		--port) PEER_PORT="${2:?}" && shift ;;
		--yes) YES=1 ;;
		--dry-run) DRY_RUN=1 ;;
		*) usage ;;
		esac
		shift
	done
	if [ -z "$PEER" ]; then load_state || die "fence needs --host user@host"; fi
	peer true 2>/dev/null || die "cannot reach $PEER over SSH"
	confirm "Stop $PEER from serving (tunnel connector, API, worker) and pause writes in its database?"
	act "stop $PEER from serving" peer_stop_serving
	if [ -n "$(peer "echo $(peer_svc postgres)")" ]; then
		act "turn on the write pause in $PEER's database" pause_peer true
	fi
	log "$PEER no longer serves. Its data is untouched; to make it a standby of this server run there: deploy/scripts/failover.sh setup --primary <this server>"
}

main() {
	local command=${1:-}
	[ $# -gt 0 ] && shift
	case "$command" in
	setup) cmd_setup "$@" ;;
	sync) cmd_sync "$@" ;;
	status) cmd_status "$@" ;;
	promote) cmd_promote "$@" ;;
	fence) cmd_fence "$@" ;;
	*) usage ;;
	esac
}
main "$@"
exit
