#!/bin/sh
# SPDX-License-Identifier: AGPL-3.0-only
# Runs inside the `primary-link` container on a warm standby (compose.ops.yaml):
# forwards port 5432 of this container to the primary server's Postgres over
# SSH, so the standby's Postgres can stream WAL from `primary-link:5432`.
# The Postgres container on the primary has no published port; its address on
# the Docker network is looked up again whenever the connection drops or the
# container gets a new address.
set -eu
setting() { grep -E "^$1=" /standby/standby.env | tail -n 1 | cut -d= -f2-; }
PEER=$(setting PEER)
PEER_PORT=$(setting PEER_PORT)
PROJECT=$(setting PEER_PROJECT)
PROJECT=${PROJECT:-skillpouch}

ssh_peer() {
	ssh -i /standby/id_ed25519 -o IdentitiesOnly=yes -o BatchMode=yes \
		-o UserKnownHostsFile=/standby/known_hosts -o StrictHostKeyChecking=yes -o UpdateHostKeys=no \
		-o ConnectTimeout=10 -o ServerAliveInterval=10 -o ServerAliveCountMax=3 \
		-p "${PEER_PORT:-22}" "$PEER" "$@"
}

postgres_address() {
	ssh_peer "docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}} {{end}}' \
		\$(docker ps -q --filter label=com.docker.compose.project=$PROJECT --filter label=com.docker.compose.service=postgres)" \
		2>/dev/null | awk '{print $1}'
}

# Stop at once on `docker stop` (sleeps run in the background so the trap fires).
tunnel=''
trap 'kill $tunnel 2>/dev/null; exit 0' TERM INT
pause() {
	sleep "$1" &
	wait $! || true
}

while :; do
	address=$(postgres_address || true)
	if [ -z "$address" ]; then
		echo "primary-link: cannot find the primary's Postgres on $PEER, retrying in 10 s" >&2
		pause 10
		continue
	fi
	echo "primary-link: forwarding :5432 to $PEER → $address:5432"
	ssh_peer -N -o ExitOnForwardFailure=yes -L "0.0.0.0:5432:$address:5432" &
	tunnel=$!
	while kill -0 "$tunnel" 2>/dev/null; do
		pause 30
		now=$(postgres_address || true)
		if [ -n "$now" ] && [ "$now" != "$address" ]; then
			echo "primary-link: the primary's Postgres moved, reconnecting" >&2
			kill "$tunnel" 2>/dev/null || true
		fi
	done
	wait "$tunnel" || true
	pause 2
done
