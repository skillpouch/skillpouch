---
title: Configuration
description: The settings files, the secrets folder and how the server finds each secret.
---

A server has three places for configuration, all inside `deploy/`:

| Place           | Holds                                                                 |
| --------------- | --------------------------------------------------------------------- |
| `env/stack.env` | Compose settings: database passwords, data folder, public hostname    |
| `env/api.env`   | API and worker settings: URLs, sign-in app IDs, billing, file storage |
| `secrets/`      | One file per secret, mounted read-only into the API and worker        |

Start from the examples (`env/stack.env.example`, `env/api.env.example`).
Every API variable is validated at startup and documented in
`apps/api/src/config/env.ts`. After a change, apply it with
`deploy/tunnel/update.sh --force` behind a tunnel, or `scripts/deploy.sh`
on a VPS.

## Compose settings

In `env/stack.env`:

| Variable                      | Meaning                                                    |
| ----------------------------- | ---------------------------------------------------------- |
| `POSTGRES_SUPERUSER_PASSWORD` | Postgres superuser password                                |
| `POSTGRES_PASSWORD`           | Password of the API's database logins                      |
| `DATA_ROOT`                   | Data folder, default `/srv/skillpouch`                     |
| `SECRETS_DIR`                 | Host folder mounted at `/run/secrets`, default `./secrets` |
| `PUBLIC_HOST`                 | Your hostname, used by the deploy smoke test               |

## API settings

In `env/api.env`:

| Variable                                                   | Meaning                                                              |
| ---------------------------------------------------------- | -------------------------------------------------------------------- |
| `API_PUBLIC_URL`, `WEB_ORIGIN`                             | `https://` plus your hostname                                        |
| `TRUST_PROXY`                                              | `true` behind Caddy                                                  |
| `ADMIN_EMAILS`                                             | Comma-separated emails that get the admin dashboard after signing in |
| `GITHUB_CLIENT_ID`, `GOOGLE_CLIENT_ID`                     | Sign-in apps ([Sign-in and GitHub](/self-hosting/sign-in/))          |
| `GITHUB_APP_ID`, `GITHUB_APP_SLUG`, `GITHUB_APP_CLIENT_ID` | Optional GitHub App for private-repository marketplaces              |
| `POLAR_SERVER`                                             | `sandbox` or `production` ([Billing](/self-hosting/billing/))        |
| `CLI_MIN_VERSION`                                          | Oldest CLI version the server accepts                                |
| `BLOB_DRIVER`, `S3_*`                                      | Where files are stored ([File storage](/self-hosting/file-storage/)) |

## Secrets

`deploy/secrets/` is created by `scripts/init-secrets.sh` (the tunnel setup
runs it for you). Git and Docker builds ignore it. Compose mounts it
read-only at `/run/secrets` in the API and worker containers. The owner is
the container user (uid 10001) with group `docker`; the folder is `770` so
the deploy user can manage it, the files are `600` so only the container can
read them.

Each file is named after its variable in lower case:

| File                                                                                                                 | Required | Format                                            |
| -------------------------------------------------------------------------------------------------------------------- | -------- | ------------------------------------------------- |
| `better_auth_secret`, `dpop_nonce_secret`, `ip_hash_secret`                                                          | yes      | 32 or more random characters                      |
| `pepper_key`                                                                                                         | yes      | 32 random bytes, base64url, no padding (43 chars) |
| `jwt_signing_key`                                                                                                    | yes      | Ed25519 private JWK (JSON)                        |
| `github_client_secret`, `google_client_secret`, `polar_access_token`, `polar_webhook_secret`, `s3_secret_access_key` | no       | as the variable                                   |
| `github_app_client_secret`, `github_app_private_key`, `github_public_token`                                          | no       | see [Sign-in and GitHub](/self-hosting/sign-in/)  |
| `database_url` and the other `database_url_*` / `*_database_url` connection strings                                  | no       | as the variable; the Compose stack sets them      |

After adding a secret by hand, fix its owner and mode:

```sh
sudo chown 10001:docker deploy/secrets/* && sudo chmod 600 deploy/secrets/*
```

In production the API looks for each secret in this order: the variable
itself, then the file named by `X_FILE`, then `$SECRETS_DIR/<x>` (default
`/run/secrets`). If a required secret is still missing it refuses to start
and lists each one with the exact path it looked for. Development and tests
never read this folder.

:::danger[Keep an offline copy]
`pepper_key` and `jwt_signing_key` are not part of the backups. Losing
`pepper_key` locks everyone out of master-password unlock.
:::
