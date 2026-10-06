# SQL performance check

Finds queries that would fall back to full table scans once the database is
large. Tiny test databases hide these, so the check runs against a synthetic
1.5 GB dataset: 20 000 accounts, 40 000 pouches, 400 000 items, 800 000
revisions, blobs and events, plus one heavy account (3 000 items).

```sh
# 1. Record every statement the backend sends (test Postgres on :55432)
docker exec skillpouch-pg-test psql -U postgres \
  -c "ALTER SYSTEM SET shared_preload_libraries = 'pg_stat_statements'"
docker restart skillpouch-pg-test
docker exec skillpouch-pg-test psql -U postgres \
  -c "CREATE EXTENSION IF NOT EXISTS pg_stat_statements" -c "SELECT pg_stat_statements_reset()"
pnpm --filter @skillpouch/api test

# 2. Build and seed the perf database
docker exec skillpouch-pg-test psql -U postgres -c "CREATE DATABASE sp_perf"
DATABASE_URL=postgres://postgres:postgres@localhost:55432/sp_perf pnpm --filter @skillpouch/db migrate
for f in seed heavy; do
  docker cp tools/perf/sql/$f.sql skillpouch-pg-test:/tmp/$f.sql
  docker exec skillpouch-pg-test psql -U postgres -d sp_perf -q -f /tmp/$f.sql
done

# 3. Plan every recorded statement (run from packages/db so `pg` resolves)
cd packages/db && node ../../tools/perf/sql/explain.mjs                      # jobs/admin (no RLS)
EXPLAIN_AS_TENANT=1 node ../../tools/perf/sql/explain.mjs                    # API (RLS applied)
```

Reading the output: API queries rely on row-level security to add
`storage_account_id = …`, so judge them by the `EXPLAIN_AS_TENANT=1` run.
Background jobs and the admin dashboard bypass RLS; judge them by the plain
run. `pg_stat_statements` replaces literals with `$n`, so a partial index whose
predicate is a literal in the source may look unused — check the source.
