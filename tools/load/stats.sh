#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-only
# Prints CPU/memory of every API replica and Postgres, plus Postgres connections, every 5 s.
while true; do
	names=$(docker ps --format '{{.Names}}' | grep -E '^skillpouch-load-(api|api-replica|postgres)-' | sort)
	stats=$(docker stats --no-stream --format '{{.Name}} cpu={{.CPUPerc}} mem={{.MemUsage}}' $names |
		sed 's/skillpouch-load-//; s/ \/ [0-9.]*[GM]iB//' | tr '\n' ' ')
	conns=$(docker exec skillpouch-load-postgres-1 psql -U postgres -Atc \
		"select count(*) from pg_stat_activity where datname = 'skillpouch'" 2>/dev/null)
	echo "$(date +%T) $stats pg_conns=$conns"
	sleep 5
done
