# Load test report (2026-10-07)

## Setup

Everything ran in the sandbox from `tools/load` (`run.sh up`, `run.sh drive`):
the production Docker image with `NODE_ENV=production`, the production
database roles and RLS, and rate limits **on**. Each simulated device
appears to come from its own IP.

- **API:** one container with 2 CPUs / 2 GiB, or 4 containers with 1.5 CPUs each for 100k.
- **Postgres 16:** 4 CPUs / 4 GiB, `shared_buffers=1GB`.
- **Data:** 100 000 seeded accounts, each with a pouch and an authorized CLI device.
- **Driver:** `driver.mjs` behaves like the real CLI daemon. It refreshes its
  DPoP-bound token, holds a long-poll or the account SSE stream, and uploads a
  sealed blob plus a signed commit, with real ECDSA signatures on every request.

All containers (APIs, Postgres, driver) share one 12-core WSL2 machine. The
driver competes with the server for CPU, so these numbers are a floor, not a
ceiling.

## Results

| Scenario                    | Devices     | Load                        | Result                                                                                                               |
| --------------------------- | ----------- | --------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Sync, 1 API                 | 2 000       | 60 commits/s                | commit p95 **28 ms**, delivered to device p95 30 ms, 0 errors                                                        |
| Idle, SSE, 1 API            | 10 000      | streams only                | API CPU **~5 %**, 465 MiB; 0 errors                                                                                  |
| Idle, long-poll 55 s, 1 API | 10 000      | polls only                  | ~180 polls/s, API ~100 % during ramp, ~2 % connect resets during ramp                                                |
| Sync, SSE, 1 API            | 10 000      | 100 commits/s               | **saturated**: about 62 commits/s max, p95 5 s                                                                       |
| **Sync, SSE, 4 APIs**       | **100 000** | 115 logins/s + 27 commits/s | commit p95 **69 ms**, delivered p95 **75 ms**, login p95 10 ms, **0 errors** on commits; 99.2 % of devices logged in |

Raw per-run JSON is in `results/` (not committed; rerun to regenerate).

## Bottlenecks found and fixed

| #   | Problem under load                                                                                                 | Fix                                                                                                      |
| --- | ------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------- |
| 1   | Postgres 16 refuses to let the app login create `BYPASSRLS` roles, so a fresh production install could not migrate | Roles are created by the superuser in `deploy/postgres/init`                                             |
| 2   | Blob volume not writable by the API user (uid 10001), so every upload got a 500                                    | The image owns `/data/blobs`, and the README gives the host `install -d` step                            |
| 3   | Idle long-polls read the database twice per poll; the wait was 25 s                                                | Subscribe before reading (one read per idle poll); wait is 55 s, about half the requests per idle device |
| 4   | The device status check took 3 queries per request                                                                 | One query, plus a bounded cache                                                                          |
| 5   | Importing the JWK on every DPoP proof cost as much as verifying it                                                 | LRU cache of imported keys                                                                               |
| 6   | The pouch-lock check was a query on every device request                                                           | 3 s cache, cleared on any pouch state change                                                             |
| 7   | Node's default accept backlog (511) reset connections in reconnect storms                                          | backlog 4096                                                                                             |
| 8   | Access tokens lasting 5 min meant 100k devices refreshing ~330/s                                                   | 15 min (revocation is still checked on every request); about 110/s                                       |
| 9   | Refresh retried after a lost response looked like token theft and revoked the device                               | A retry with the previous token within 60 s (same DPoP key) is allowed                                   |
| 10  | Overload made every request queue until timeout                                                                    | Load shedding: 503 `server_busy` with a jittered Retry-After while event-loop lag exceeds 500 ms         |
| 11  | SSE streams recycled every 4–5 min, about 400 reconnects/s at 100k                                                 | 10–15 min (revocation still ends a stream immediately)                                                   |

## Weak points and what to do

1. **Commit throughput per API process: about 60–75 commits/s on 2 CPUs.** It is
   CPU-bound on ECDSA verification (DPoP, request signature, member signature)
   and socket writes. Real users commit rarely (a skill edit is a burst, then
   nothing), so 100k devices need about 4 processes. Scale horizontally: the API
   is stateless, and Caddy can balance replicas.
2. **Memory per open stream: about 40 KB.** That is roughly 1.1 GiB per 25k
   streams. Plan about 2 GiB per 25k connected devices, or move idle CLIs to
   long-poll, which holds no server state between polls.
3. **Postgres stays light:** 50–110 % of one core at 100k, under 35
   connections. Its hottest statements are the `dpop_replay` and `rate_limits`
   upserts (two writes per request). Past ~5k requests/s, move both to Redis or
   memory with sticky routing. The tables are UNLOGGED, and they need a purge job
   (dpop_replay already has one).
4. **Login storms after an outage:** 100k devices logging in at once overload a
   small cluster. Load shedding plus the CLI's backoff and jitter keep it
   recoverable; the CLI must honor `Retry-After`.
5. **About 0.8 % `dpop_invalid` on logins at 100k.** These came from proofs that
   aged past the 60 s window in the driver's own queue on the saturated test
   host, not from server rejections of fresh proofs. The real CLI retries with a
   fresh proof.

## Sizing guide

| Connected devices | API                 | Postgres      |
| ----------------- | ------------------- | ------------- |
| ≤ 10 000          | 1 × 2 vCPU / 2 GB   | 2 vCPU / 4 GB |
| ≤ 50 000          | 2–3 × 2 vCPU / 4 GB | 4 vCPU / 8 GB |
| ≤ 100 000         | 4 × 2 vCPU / 4 GB   | 4 vCPU / 8 GB |
