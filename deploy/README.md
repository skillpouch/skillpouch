# Deploying SkillPouch

One host (Hetzner CX32 + volume) runs everything with Docker Compose:

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
   backups.**
2. `cp env/stack.env.example env/stack.env`, `cp env/api.env.example env/api.env`, fill them.
3. `docker compose --env-file env/stack.env up -d postgres caddy`
4. `scripts/deploy.sh ghcr.io/skillpouch/api:<version>` — migrates, starts the
   first color, switches Caddy; start the worker with `docker compose --env-file env/stack.env up -d worker`.

## Secrets

`deploy/secrets/` is tracked by git (`.gitkeep`) but its contents are
ignored by git and by Docker builds. Compose mounts it read-only at
`/run/secrets` in the API and worker containers (container user uid 10001;
folder `700`, files `600`).

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
2. Add a webhook endpoint `https://skillpouch.net/v1/billing/webhooks/polar`,
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

## Backups and moving hosts

`scripts/backup.sh` (nightly timer): `pg_dump` + immutable blob files to
restic. Moving hosts = attach the volume (or rsync blobs + restore the dump)
on the new machine, copy `deploy/secrets/`, run `deploy.sh`, move the
Floating IP. For an always-on move use a streaming replica and the admin
write-pause toggle during switchover.
