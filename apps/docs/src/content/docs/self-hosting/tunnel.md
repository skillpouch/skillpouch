---
title: Install behind Cloudflare Tunnel
description: Run SkillPouch on any Linux machine, reachable over HTTPS through Cloudflare Tunnel, with automatic deploys.
---

Any Linux machine (a computer at home, an old PC, a VPS) can serve
SkillPouch through Cloudflare Tunnel: no open router ports, HTTPS by
Cloudflare, and every push to `main` deploys itself with zero downtime and
automatic rollback.

The examples use `app.skillpouch.net`; use your own hostname.

## 1. Give the server read access to the repository

On the server:

```sh
ssh-keygen -t ed25519 -N '' -f ~/.ssh/id_ed25519 -C skillpouch-server
cat ~/.ssh/id_ed25519.pub
```

On GitHub, open your copy of the repository → **Settings → Deploy keys →
Add deploy key**, paste the key and leave write access off.

## 2. Clone and run the setup

```sh
git clone git@github.com:skillpouch/skillpouch.git ~/skillpouch
~/skillpouch/deploy/tunnel/setup.sh
```

The setup:

- installs Docker, `cloudflared` and automatic security updates
- creates the data folders in `/srv/skillpouch`
- generates the [secrets](/self-hosting/configuration/#secrets) and database
  passwords
- starts Postgres and Caddy
- prepares automatic deploys and runs the first deploy

The first run takes 10–20 minutes. Running it again is safe: it keeps your
secrets and env files.

:::caution[Back up two keys now]
Copy `deploy/secrets/pepper_key` and `deploy/secrets/jwt_signing_key`
somewhere offline. They are not in backups, and losing `pepper_key` locks
everyone out of master-password unlock.
:::

## 3. Configure the app

Edit `~/skillpouch/deploy/env/api.env`:

- `ADMIN_EMAILS`: your email, for the admin dashboard
- `API_PUBLIC_URL` and `WEB_ORIGIN`: your hostname
- the GitHub and/or Google sign-in apps ([Sign-in and GitHub](/self-hosting/sign-in/))
- billing, only if you want paid plans ([Billing](/self-hosting/billing/))

Set `PUBLIC_HOST` in `deploy/env/stack.env` to the same hostname. Apply the
changes:

```sh
~/skillpouch/deploy/tunnel/update.sh --force
```

All settings are described in [Configuration](/self-hosting/configuration/).

## 4. Connect the tunnel

1. In the Cloudflare dashboard open **Zero Trust → Networks → Tunnels →
   Create a tunnel → Cloudflared** and give it a name.
2. Copy the `sudo cloudflared service install <token>` command it shows and
   run it on the server.
3. Add a **Public hostname**: your hostname → service `HTTP` →
   `localhost:80`.

Open your hostname in a browser. SkillPouch is running.

## 5. Deploy from GitHub Actions

After CI passes on `main`, the `app deploy` workflow runs on the server through
a self-hosted runner. Install the runner once, as the same user that ran
`setup.sh`:

1. On GitHub, open the repository → **Settings → Actions → Runners → New
   self-hosted runner** → Linux and your architecture.
2. `setup.sh` already downloaded the runner to `~/actions-runner`. Copy only
   the token from GitHub's page, then:

   ```sh
   cd ~/actions-runner
   ./config.sh --url https://github.com/<owner>/skillpouch --token <TOKEN> \
     --name "$(hostname)" --labels skillpouch-server --unattended
   sudo ./svc.sh install && sudo ./svc.sh start
   ```

3. Set the repository variable `SKILLPOUCH_DIR` (**Settings → Secrets and
   variables → Actions → Variables**) to the checkout's path, for example
   `/home/deploy/skillpouch`.

The runner updates itself. If the server is offline for more than 14 days,
GitHub removes it; run `config.sh` again with a new token.

:::tip[Polling instead of a runner]
`AUTO_UPDATE=timer deploy/tunnel/setup.sh` installs a timer that deploys
new commits of `main` every 2 minutes, without waiting for CI.
:::

## Next

- [Deploys and day-to-day](/self-hosting/deploys/)
- [Backups](/self-hosting/backups/)
