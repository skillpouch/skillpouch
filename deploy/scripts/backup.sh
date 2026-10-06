#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-only
# Nightly backup (plan 10 §6): logical dump + immutable blobs to restic
# (e.g. a Hetzner Storage Box). Secrets (PEPPER_KEY, JWT key) are NOT backed
# up here — they live only in /etc/skillpouch/secrets + the offline copy.
set -euo pipefail
cd "$(dirname "$0")/.."
: "${RESTIC_REPOSITORY:?}" "${RESTIC_PASSWORD_FILE:?}"
DATA_ROOT="${DATA_ROOT:-/srv/skillpouch}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$DATA_ROOT/backups"
docker compose --env-file env/stack.env exec -T postgres \
	pg_dump -U postgres -d skillpouch --format=custom > "$DATA_ROOT/backups/skillpouch-$STAMP.dump"
restic backup --tag skillpouch "$DATA_ROOT/backups/skillpouch-$STAMP.dump" "$DATA_ROOT/blobs"
restic forget --tag skillpouch --keep-daily 14 --keep-weekly 8 --keep-monthly 12 --prune
find "$DATA_ROOT/backups" -name 'skillpouch-*.dump' -mtime +2 -delete
