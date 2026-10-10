# Deploying SkillPouch

One host (Hetzner CX32 + volume) runs the app and API (`app.skillpouch.net`)
with Docker Compose; the landing page (`skillpouch.net`) is a static site on
Cloudflare Pages (see `EXTERNAL-SERVICES.md`):

```
Caddy (TLS, SPA, /v1 → live color) ─┬─ api-blue  ┐  same image,
                                    └─ api-green ┘  API_ROLE=api
worker (API_ROLE=worker, pg-boss) · postgres 16 · blobs on /srv/skillpouch/blobs
```

## First install

1. Mount the data volume at `/srv/skillpouch` (LUKS) and run
   `sudo scripts/init-secrets.sh`. It fills `deploy/secrets/` (see
   [Secrets](#secrets)) and never overwrites an existing file. **Copy
   `pepper_key` and `jwt_signing_key` somewhere offline — they are not in
   backups.** Then give the API user (uid 10001) the blob directory:
   `sudo install -d -o 10001 -g 10001 -m 700 /srv/skillpouch/blobs`.
2. `cp env/stack.env.example env/stack.env`, `cp env/api.env.example env/api.env`, fill them.
3. `docker compose --env-file env/stack.env up -d postgres caddy`
4. `scripts/deploy.sh ghcr.io/skillpouch/api:<version>` — migrates, starts the
   first color, switches Caddy; start the worker with `docker compose --env-file env/stack.env up -d worker`.

## Secrets

`deploy/secrets/` is created by `init-secrets.sh` and ignored by git and by
Docker builds. Compose mounts it read-only at `/run/secrets` in the API and
worker containers. Owner is the container user (uid 10001) with group
`docker`: folder `770` (the deploy user can manage it), files `600` (only the
container can read them).

One file per secret, named after the variable in lower case:

| File                                                                                                          | Required | Format                                            |
| ------------------------------------------------------------------------------------------------------------- | -------- | ------------------------------------------------- |
| `better_auth_secret`, `dpop_nonce_secret`, `ip_hash_secret`                                                   | yes      | ≥ 32 random chars                                 |
| `pepper_key`                                                                                                  | yes      | 32 random bytes, base64url, no padding (43 chars) |
| `jwt_signing_key`                                                                                             | yes      | Ed25519 private JWK (JSON)                        |
| `github_client_secret`, `google_client_secret`, `polar_access_token`, `polar_webhook_secret`, `database_url*` | no       | as the variable                                   |

At production boot the API resolves every secret as: the variable itself →
`X_FILE` → `$SECRETS_DIR/<x>` (default `/run/secrets`). If a required one is
still missing it refuses to start and prints each missing secret with the
exact path it looked for. Development and test never read this folder; they
use built-in dev values.

## Billing (Polar)

Billing is optional: without `polar_access_token` + `polar_webhook_secret`
every billing route answers `billing_unavailable` and everyone stays on Free.

1. In Polar (start with `POLAR_SERVER=sandbox`), create an organization access
   token and save it as `secrets/polar_access_token`.
2. Add a webhook endpoint `https://app.skillpouch.net/v1/billing/webhooks/polar`,
   format **Raw**, events `subscription.created`, `subscription.updated`,
   `subscription.active`, `subscription.canceled`, `subscription.uncanceled`,
   `subscription.revoked`. Save its secret as `secrets/polar_webhook_secret`.
3. In the admin dashboard, edit the Supporter plan and save it once: the API
   creates the Polar product and stores its id (`plans.polar_product_id`).

Flow: `POST /v1/billing/checkout` returns a hosted Polar checkout URL tied to
the account (`external_customer_id`). Polar then calls the webhook; the API
verifies the signature, stores the event once (duplicates are ignored, older
updates never overwrite newer ones) and recomputes the plan limits. A daily
`billing.reconcile` job re-reads open subscriptions in case a webhook was
missed. Downgrades never delete data: extra pouches become read-only.

## Zero-downtime deploys

`scripts/deploy.sh <image>`: pull → **automatic expand-only migration**
(failure stops the deploy; live color untouched) → start idle color → wait
for `/readyz` → canary check of its 5xx count → Caddy graceful reload →
drain the old color (SSE clients receive `event: reconnect`, long-polls wake,
25 s grace) → restart worker → smoke test, otherwise automatic rollback.
`scripts/rollback.sh` switches back to the previous color in seconds.

Migrations are SQL files with a `-- phase: expand|contract` header, applied
under an advisory lock with `lock_timeout` + retries; destructive changes
ship as a later `contract` migration.

## Moving files to R2

Files can live in any S3-compatible bucket instead of the blobs volume
(set-up in `EXTERNAL-SERVICES.md`). To move a running server without
downtime:

1. Add `S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY_ID` and
   `S3_SECRET_ACCESS_KEY` to `env/api.env` (or the secret to
   `secrets/s3_secret_access_key`), keep `BLOB_DRIVER=fs`, and deploy, so the
   API container has the settings.
2. Copy the files (the live API keeps using the volume meanwhile):
   `docker exec -e API_ROLE=copy-blobs -e BLOB_DRIVER=s3 <live api container> node dist/main.mjs`
   (`docker ps --filter name=api` shows it). It logs `blobs copied` with counts.
3. Set `BLOB_DRIVER=s3` and deploy again.
4. Run step 2 once more: it copies only what was uploaded in between and
   skips the rest. Keep the volume until you've checked a few pouches.

With R2, back up the bucket with R2's own tools or `rclone`; `backup.sh`
covers only the volume.

## Backups and moving hosts

`scripts/backup.sh` (nightly timer): `pg_dump` + immutable blob files to
restic. Moving hosts = attach the volume (or rsync blobs + restore the dump)
on the new machine, copy `deploy/secrets/`, run `deploy.sh`, move the
Floating IP. For an always-on move see
[Standby and moving to a new server](#standby-and-moving-to-a-new-server).

## Standby and moving to a new server

Two scripts for servers behind Cloudflare Tunnel, both run on the **second**
server (the standby, or the new server), from its checkout of this repository:

- `scripts/failover.sh` keeps a warm standby and promotes it when the primary
  dies.
- `scripts/migrate-host.sh` moves a running service to a new server, with a
  write pause of a few seconds instead of downtime.

> **Not rehearsed in production yet.** The scripts have only been run
> against throwaway containers. Rehearse both on two spare machines (or
> staging) before you depend on them, and repeat the rehearsal after larger
> changes to the stack.

### How it works

- **Database:** the second server's Postgres is a streaming replica of the
  primary's (hot standby, read-only). It connects through an SSH link
  (`compose.ops.yaml` → `primary-link`), so the primary's Postgres stays
  unpublished. `setup` creates a replication login and slot named
  `replica_<hostname>` on the primary, a `pg_hba` line for `replica_*` logins
  and, if none is set, caps the WAL a slot may hold back at 8 GB
  (`STANDBY_MAX_WAL`) so a standby that stays offline can't fill the
  primary's disk. After the cap is exceeded the standby needs
  `failover.sh setup --rebuild`.
- **Files:** with `BLOB_DRIVER=s3` both servers use the same bucket and
  nothing is copied. With the blobs volume, files missing on the second
  server are copied every few minutes (they never change once stored).
- **Config:** `env/*.env` and `secrets/` are copied from the primary; a
  standby needs the same database passwords, `pepper_key` and
  `jwt_signing_key`. The Cloudflare Tunnel token is copied from
  `env/tunnel.env` or read from the primary's `cloudflared` service.
- **Release:** the API image the primary runs is copied (or pulled from its
  registry, or built for another CPU architecture from the same commit), and
  so is the live web release.
- **Cutover:** the second server runs a Cloudflare Tunnel connector with the
  same token (the `cloudflared` service in `compose.ops.yaml`). Cloudflare
  routes requests to any connected connector of a tunnel, so the second
  server can answer as soon as it connects, and the primary stops when
  its connector stops. No DNS change.
- **Write pause:** the same switch as the admin dashboard's write pause,
  written straight into `system_settings`. Mutating requests wait up to 10 s,
  then get a retryable `503 maintenance_write_pause`; reads keep working.

Everything privileged goes through Docker, so no sudo is needed, except to
stop a `cloudflared` that was installed as a system service.

### Requirements

- The second server is prepared like the first (Docker, the repository
  cloned, the user in the `docker` group, the data volume mounted at the same
  `DATA_ROOT`), but **without** `tunnel/setup.sh`'s last steps: no
  `cloudflared service install`, no Actions runner and no update timer. Those
  would serve or deploy from it.
- Keep its checkout on a recent `main` (`git pull`); the scripts don't move
  it.
- SSH from the second server to the primary. The first run of `setup` creates
  `deploy/standby/id_ed25519` and prints the `ssh-copy-id` command that
  authorizes it. That key can use Docker on the primary, which is
  root-equivalent: `deploy/standby/` is git-ignored, keep it private. The
  primary's sshd must allow TCP forwarding (`AllowTcpForwarding`, on by
  default on Debian and Ubuntu).
- Both servers run the same Postgres major version (`compose.yaml` pins it).

### Warm standby

On the standby:

```sh
deploy/scripts/failover.sh setup --primary deploy@primary.example --dry-run
deploy/scripts/failover.sh setup --primary deploy@primary.example
deploy/scripts/failover.sh status
```

`setup` copies config and secrets, sets up replication, copies the database
(`pg_basebackup`), the release and the files, and installs a cron job that
runs `failover.sh sync` every 5 minutes (`--every N`). It asks before
replacing a database on the standby and refuses one that holds accounts
(`--replace-local-database` overrides). Running it again is safe: an
already streaming standby isn't copied again. Options: `--port` (SSH port),
`--peer-dir` (the checkout on the primary, default the same path), `--yes`.

`status` shows the WAL receiver, how far the standby is behind, the slot on
the primary, the last file sync and whether the primary and the public URL
answer. The sync log is `deploy/standby/sync.log`.

What a failover can lose: replication is asynchronous, so the last moments
before a crash may not have reached the standby (`status` shows the lag), and
with the blobs volume, files uploaded since the last sync. With `s3` storage
only the replication lag applies.

### Failover: the primary is gone

```sh
deploy/scripts/failover.sh promote --dry-run
deploy/scripts/failover.sh promote
```

It refuses while the primary still answers (use `migrate-host.sh` for a
planned move; `--force` takes over anyway and stops the primary first if it
can reach it), and warns if `https://<PUBLIC_HOST>` still answers although
the primary can't be reached. Then it promotes Postgres, turns the write pause
off, starts the API, worker and Caddy with the recorded release and connects
the tunnel. If no release was copied, deploy after promotion with
`deploy/tunnel/update.sh --force`.

Afterwards:

1. **Fence the old server before it comes back.** It would reconnect to the
   same tunnel with old data. As soon as SSH works:
   `deploy/scripts/failover.sh fence --host deploy@old.example` (stops its
   tunnel connector, API and worker and turns on the write pause in its
   database). The surest fence: create a new tunnel in Cloudflare, move the
   public hostname to it, put the new token in `env/tunnel.env` on the new
   primary and recreate its `cloudflared` container.
2. Move deploys: install the Actions runner on the new primary
   ([tunnel guide](tunnel/README.md) §5) and remove the old one.
3. Set up a new standby, e.g. the repaired old server:
   `failover.sh setup --primary <new primary>` there (replaces its database).

### Moving to a new server

On the new server:

```sh
deploy/scripts/migrate-host.sh --from deploy@old.example --dry-run
deploy/scripts/migrate-host.sh --from deploy@old.example
```

1. **Prepare:** runs `failover.sh setup`, so the new server becomes a
   streaming standby with config, release and files (this takes as long as the
   database copy; nothing changes for users).
2. **Checks:** streaming, the old server answers, the release and tunnel token
   are here, last file copy. Then it asks once.
3. **Switch:** stops the old worker → turns on the write pause in the old
   database → waits 3 s (API instances cache the flag for 2 s) and until
   writes that started before the pause have finished → copies the last files
   → waits until the new database has replayed everything → promotes it →
   starts the API → connects the tunnel here → turns the write pause off →
   starts the worker. It prints how long writes were paused.
4. **Drain:** stops the old server's tunnel connector, API and worker, and
   copies files that finished uploading meanwhile. The old database is left
   as it was, with the write pause on, as a fallback.

If a step fails before the promotion, the pause is lifted and the old worker
restarted: the old server carries on and the new one stays its standby. After
the promotion it prints how to finish with `failover.sh promote --force` and
`failover.sh fence`. Running `migrate-host.sh` again after a finished move
stops at the account check instead of replacing the new database.

What users notice: writes are held while the pause lasts, which is roughly
the time the API takes to start after promotion (about 8 s in a test with
containers on one machine). Writes held on the new server succeed when the
pause ends; writes still waiting on the old server after 10 s get the
retryable 503 and the clients send them again, now to the new server.
SSE and long-poll clients reconnect and resume from their cursor. Sync
operations are idempotent, so retries never apply twice. Other writes to the
old server during the switch that bypass the pause (a sign-in, a billing
webhook) can be lost: a sign-in may have to be repeated, and the daily
billing reconcile picks up missed subscription changes.

If `cloudflared` on the old server is a system service, stopping it needs
sudo there: either passwordless sudo for the deploy user, or run the script in
a terminal and type the password when asked (until then the old server still
answers part of the requests). After the move:

- move deploys (Actions runner or update timer) to the new server;
- the new server's tunnel connector is the `cloudflared` container. Compose
  calls it an orphan in `update.sh`'s output, which is harmless. To use a
  system service instead: `sudo cloudflared service install <token>`, then
  `docker compose --profile cloudflared rm -sf cloudflared` (run in `deploy/`
  with `COMPOSE_FILE=compose.yaml:tunnel/compose.tunnel.yaml:compose.ops.yaml`);
- keep the old server as a standby of the new one for a while:
  `failover.sh setup --primary <new server>` there.
