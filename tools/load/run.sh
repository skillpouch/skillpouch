#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-only
# Load-test sandbox lifecycle.
#   run.sh up [accounts]   secrets, database, migrations, API, seed (default 100000)
#   run.sh down            stop and delete everything, data included
set -euo pipefail
cd "$(dirname "$0")"
export REPO_DIR="$(cd ../.. && pwd)"
compose() { docker compose -f compose.yaml "$@"; }

case "${1:-}" in
up)
	SECRETS_DIR="$PWD/.secrets" ../../deploy/scripts/init-secrets.sh >/dev/null
	# Sandbox only: the container user must read them without a root chown.
	chmod 755 .secrets && chmod 644 .secrets/*
	compose up -d --wait postgres
	compose run --rm migrate
	compose up -d --wait api
	node seed.mjs "${2:-100000}"
	;;
drive)
	# run.sh drive --scenario idle --users 10000 --duration 120
	shift
	./stats.sh > "results/raw/stats-$(date +%s).log" &
	sampler=$!
	trap 'kill $sampler 2>/dev/null' EXIT
	compose run --rm driver "$@"
	;;
down)
	compose down -v --remove-orphans
	rm -rf .secrets accounts.ndjson
	;;
*)
	echo "usage: run.sh up [accounts] | drive <driver args> | down" >&2
	exit 2
	;;
esac
