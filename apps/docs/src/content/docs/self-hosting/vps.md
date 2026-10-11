---
title: Install on a VPS
description: Run SkillPouch on a server with a public IP, with Caddy handling TLS.
---

On a server with a public IP, Caddy answers on ports 80 and 443 and gets its
TLS certificate itself. Point your hostname's DNS at the server first.

## 1. Data volume and secrets

1. Mount the data volume at `/srv/skillpouch`. Encrypting it (LUKS) is
   recommended.
2. From the repository's `deploy/` folder, create the secrets:

   ```sh
   sudo scripts/init-secrets.sh
   ```

   It fills `deploy/secrets/` and never overwrites a file that exists
   ([Secrets](/self-hosting/configuration/#secrets)).

3. Give the API container's user (uid 10001) the folder for files:

   ```sh
   sudo install -d -o 10001 -g 10001 -m 700 /srv/skillpouch/blobs
   ```

:::caution[Back up two keys now]
Copy `pepper_key` and `jwt_signing_key` from `deploy/secrets/` somewhere
offline. They are not in backups, and losing `pepper_key` locks everyone
out of master-password unlock.
:::

## 2. Settings

```sh
cp env/stack.env.example env/stack.env
cp env/api.env.example env/api.env
```

Fill both files ([Configuration](/self-hosting/configuration/)). In
`deploy/Caddyfile`, replace `app.skillpouch.net` with your hostname and the
`email` line with your address for the TLS certificate.

## 3. Start

```sh
docker compose --env-file env/stack.env up -d postgres caddy
scripts/deploy.sh ghcr.io/skillpouch/api:<version>
docker compose --env-file env/stack.env up -d worker
```

`deploy.sh` runs the database migrations, starts the first API color and
switches Caddy to it. See [Deploys](/self-hosting/deploys/) for updates and
rollbacks.
