# Deploying SkillPouch (plan 10)

One host (Hetzner CX32 + volume) runs everything with Docker Compose:

```
Caddy (TLS, SPA, /v1 → live color) ─┬─ api-blue  ┐  same image,
                                    └─ api-green ┘  API_ROLE=api
worker (API_ROLE=worker, pg-boss) · postgres 16 · blobs on /srv/skillpouch/blobs
```

## First install

1. Mount the data volume at `/srv/skillpouch` (LUKS) and create
   `/etc/skillpouch/secrets/` with `better_auth_secret`, `dpop_nonce_secret`,
   `ip_hash_secret` (≥ 32 chars each), `pepper_key` (32 random bytes,
   base64url — **keep an offline copy, it is not in backups**) and
   `jwt_signing_key` (Ed25519 private JWK).
2. `cp env/stack.env.example env/stack.env`, `cp env/api.env.example env/api.env`, fill them.
3. `docker compose --env-file env/stack.env up -d postgres caddy`
4. `scripts/deploy.sh ghcr.io/skillpouch/api:<version>` — migrates, starts the
   first color, switches Caddy; start the worker with `docker compose --env-file env/stack.env up -d worker`.

## Zero-downtime deploys

`scripts/deploy.sh <image>`: pull → **automatic expand-only migration**
(failure stops the deploy; live color untouched) → start idle color → wait
for `/readyz` → canary check of its 5xx count → Caddy graceful reload →
drain the old color (SSE clients receive `event: reconnect`, long-polls wake,
25 s grace) → restart worker → smoke test, otherwise automatic rollback.
`scripts/rollback.sh` switches back to the previous color in seconds.

Migrations are SQL files with a `-- phase: expand|contract` header, applied
under an advisory lock with `lock_timeout` + retries; destructive changes
ship as a later `contract` migration (plan 10 §5.2).

## Backups and moving hosts

`scripts/backup.sh` (nightly timer): `pg_dump` + immutable blob files to
restic. Moving hosts = attach the volume (or rsync blobs + restore the dump)
on the new machine, copy `/etc/skillpouch/secrets`, run `deploy.sh`, move the
Floating IP. For an always-on move use a streaming replica and the admin
write-pause toggle during switchover (plan 10 §7).
