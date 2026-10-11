---
title: Performance
description: Load test results for the SkillPouch API, its known limits, and how to check query plans against a large database.
---

## Load test

The load test in `tools/load` (`run.sh up`, then `run.sh drive`) runs the
production Docker image with `NODE_ENV=production`, the production database
roles and row-level security, and rate limits on. Each simulated device
comes from its own IP.

- **API:** one container with 2 CPUs and 2 GiB, or four with 1.5 CPUs each
  for 100 000 devices
- **Postgres 16:** 4 CPUs, 4 GiB, `shared_buffers=1GB`
- **Data:** 100 000 accounts, each with a pouch and an authorized CLI device
- **Driver:** `driver.mjs` behaves like the real background sync. It
  refreshes its token, holds a long-poll or the streaming connection, and
  uploads an encrypted file plus a signed commit, with real signatures on
  every request.

Everything shared one 12-core machine, so the driver competed with the
server for CPU: the numbers are a floor, not a ceiling. Results from
October 2026:

| Scenario                    | Devices     | Load                        | Result                                                                                         |
| --------------------------- | ----------- | --------------------------- | ---------------------------------------------------------------------------------------------- |
| Sync, 1 API                 | 2 000       | 60 commits/s                | commit p95 **28 ms**, delivered to other devices p95 30 ms, no errors                          |
| Idle, streaming, 1 API      | 10 000      | connections only            | API CPU **about 5 %**, 465 MiB, no errors                                                      |
| Idle, long-poll 55 s, 1 API | 10 000      | polls only                  | about 180 polls/s; API near 100 % during the ramp, about 2 % connection resets during the ramp |
| Sync, streaming, 1 API      | 10 000      | 100 commits/s               | **saturated** at about 62 commits/s, p95 5 s                                                   |
| **Sync, streaming, 4 APIs** | **100 000** | 115 logins/s + 27 commits/s | commit p95 **69 ms**, delivered p95 **75 ms**, login p95 10 ms, no commit errors               |

### Known limits

1. **About 60–75 commits per second per API process on 2 CPUs.** Commits
   are CPU-bound on signature checks and socket writes. Real use is bursty
   (a skill edit, then nothing), so 100 000 devices need about four
   processes. The API is stateless and scales horizontally.
2. **About 40 KB of memory per open stream**, roughly 1.1 GiB per 25 000
   streams. Plan about 2 GiB per 25 000 connected devices.
3. **Postgres stays light:** 50–110 % of one core at 100 000 devices, under
   35 connections. The hottest statements are the DPoP replay and rate
   limit upserts, two writes per request. Past about 5 000 requests per
   second they should move to memory or Redis.
4. **Login storms after an outage** overload a small cluster. Load
   shedding answers [`server_busy`](/errors/server_busy/) with a jittered
   `Retry-After` while the server is overloaded, and the background sync
   retries with growing pauses. The CLI doesn't read `Retry-After` yet.

Server sizes derived from these numbers are in the
[self-hosting overview](/self-hosting/#how-big-a-server).

## Query plans on a large database

Tiny test databases hide queries that would scan whole tables once the
database is large. `tools/perf/sql` checks every statement the API sends
against a synthetic 1.5 GB dataset: 20 000 accounts, 40 000 pouches,
400 000 items, 800 000 revisions, files and events, plus one heavy account
with 3 000 items.

1. Record every statement the API sends, using the test Postgres:

   ```sh
   docker exec skillpouch-pg-test psql -U postgres \
     -c "ALTER SYSTEM SET shared_preload_libraries = 'pg_stat_statements'"
   docker restart skillpouch-pg-test
   docker exec skillpouch-pg-test psql -U postgres \
     -c "CREATE EXTENSION IF NOT EXISTS pg_stat_statements" -c "SELECT pg_stat_statements_reset()"
   pnpm --filter @skillpouch/api test
   ```

2. Build and seed the performance database:

   ```sh
   docker exec skillpouch-pg-test psql -U postgres -c "CREATE DATABASE sp_perf"
   DATABASE_URL=postgres://postgres:postgres@localhost:55432/sp_perf pnpm --filter @skillpouch/db migrate
   for f in seed heavy; do
     docker cp tools/perf/sql/$f.sql skillpouch-pg-test:/tmp/$f.sql
     docker exec skillpouch-pg-test psql -U postgres -d sp_perf -q -f /tmp/$f.sql
   done
   ```

3. Plan every recorded statement, from `packages/db`:

   ```sh
   cd packages/db
   node ../../tools/perf/sql/explain.mjs                     # jobs and admin (no row-level security)
   EXPLAIN_AS_TENANT=1 node ../../tools/perf/sql/explain.mjs # API (row-level security applied)
   ```

API queries rely on row-level security to add the account filter, so judge
them by the `EXPLAIN_AS_TENANT=1` run. Background jobs and the admin
dashboard bypass row-level security; judge them by the plain run.
`pg_stat_statements` replaces literals with `$n`, so a partial index whose
condition is a literal in the source can look unused: check the source.
