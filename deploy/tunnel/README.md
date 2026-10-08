# Self-hosting behind Cloudflare Tunnel

Any Linux machine — a Raspberry Pi at home, an old PC, a VPS — reachable as
`https://skillpouch.net` through Cloudflare Tunnel: no open router ports, HTTPS by Cloudflare, and every push
to `main` deploys itself (zero downtime, automatic rollback).

Needs: Debian, Ubuntu or Raspberry Pi OS, **64-bit** (amd64 or arm64), 4 GB+
RAM. On a Raspberry Pi, boot from an **SSD** (Postgres wears out SD cards).

## 1. Give the server read access to the repo

```sh
ssh-keygen -t ed25519 -N '' -f ~/.ssh/id_ed25519 -C skillpouch-server
cat ~/.ssh/id_ed25519.pub
```

GitHub → `skillpouch/skillpouch` → Settings → Deploy keys → **Add deploy key**
→ paste it, _leave write access off_.

## 2. Clone and run the setup (once)

```sh
git clone git@github.com:skillpouch/skillpouch.git ~/skillpouch
~/skillpouch/deploy/tunnel/setup.sh
```

It installs Docker, cloudflared and security updates, creates
`/srv/skillpouch`, generates secrets and database passwords, starts Postgres
and Caddy, installs the auto-update timer and runs the first deploy
(10–20 minutes the first time). Run it again any time; it keeps your
secrets and env files.

**Back up `deploy/secrets/pepper_key` and `jwt_signing_key` somewhere
offline.** Losing `pepper_key` locks everyone out of master-password unlock.

## 3. Configure the app

Edit `~/skillpouch/deploy/env/api.env`:

- `ADMIN_EMAILS` — your email
- GitHub / Google OAuth app ids; callback URLs
  `https://skillpouch.net/v1/auth/callback/github` and `…/google`
  (secrets go in `deploy/secrets/github_client_secret`, `google_client_secret`)
- optional Polar keys (sandbox first)

Apply: `~/skillpouch/deploy/tunnel/update.sh --force`

## 4. Cloudflare Tunnel

Cloudflare dashboard → Zero Trust → Networks → **Tunnels** → Create →
Cloudflared → name it e.g. `skillpouch-home`. Copy the `sudo cloudflared service
install <token>` command it shows and run it on the server. Then add a
**Public hostname**: `skillpouch.net` → service `HTTP` → `localhost:80`.

Open https://skillpouch.net — done.

## 5. Deploys from GitHub Actions (self-hosted runner)

After CI passes on `main`, the `deploy` workflow runs on this server. Install
the runner once, as the same user that ran `setup.sh`:

1. GitHub → `skillpouch/skillpouch` → Settings → Actions → Runners →
   **New self-hosted runner** → Linux, your architecture (ARM64 on a Pi).
2. `setup.sh` already downloaded the right runner to `~/actions-runner`; from
   GitHub's page copy only the token, then:
   ```sh
   ./config.sh --url https://github.com/skillpouch/skillpouch --token <TOKEN> \
     --name "$(hostname)" --labels skillpouch-server --unattended
   sudo ./svc.sh install && sudo ./svc.sh start
   ```
3. If the repo isn't cloned at `/home/fenish/skillpouch`, set the repository
   variable `SKILLPOUCH_DIR` (Settings → Secrets and variables → Actions →
   Variables) to its path.

The runner updates itself. If the server is offline for more than 14 days,
GitHub removes it: run `config.sh` again with a new token.

Prefer polling instead? `AUTO_UPDATE=timer deploy/tunnel/setup.sh` installs a
timer that deploys new commits of `main` every 2 minutes (without waiting for CI).

## Day to day

|                                |                                                                                             |
| ------------------------------ | ------------------------------------------------------------------------------------------- |
| Deploy                         | push/merge to `main`; deployed right after CI passes                                        |
| Watch a deploy                 | GitHub → Actions → deploy                                                                   |
| Deploy now / a specific commit | Actions → deploy → Run workflow → `deploy` (+ commit), or `deploy/tunnel/update.sh --force` |
| Roll back the API              | Actions → deploy → Run workflow → `rollback`                                                |
| Stop auto-deploys              | Actions → deploy → ⋯ → Disable workflow                                                     |
| Logs                           | `cd deploy && docker compose --env-file env/stack.env logs -f api-blue api-green worker`    |
| Backup                         | `deploy/scripts/backup.sh`                                                                  |
