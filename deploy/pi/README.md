# SkillPouch on a Raspberry Pi

A test server at home, reachable as `https://skillpouch.net` through
Cloudflare Tunnel: no open router ports, HTTPS by Cloudflare, and every push
to `main` deploys itself (zero downtime, automatic rollback).

Needs: Pi 4/5 with 4–8 GB RAM, **64-bit** Raspberry Pi OS Lite or Ubuntu
Server, booting from an **SSD** (Postgres wears out SD cards).

## 1. Give the Pi read access to the repo

```sh
ssh-keygen -t ed25519 -N '' -f ~/.ssh/id_ed25519 -C skillpouch-pi
cat ~/.ssh/id_ed25519.pub
```

GitHub → `skillpouch/skillpouch` → Settings → Deploy keys → **Add deploy key**
→ paste it, _leave write access off_.

## 2. Clone and run the setup (once)

```sh
git clone git@github.com:skillpouch/skillpouch.git ~/skillpouch
~/skillpouch/deploy/pi/setup.sh
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

Apply: `~/skillpouch/deploy/pi/update.sh --force`

## 4. Cloudflare Tunnel

Cloudflare dashboard → Zero Trust → Networks → **Tunnels** → Create →
Cloudflared → name `skillpouch-pi`. Copy the `sudo cloudflared service
install <token>` command it shows and run it on the Pi. Then add a
**Public hostname**: `skillpouch.net` → service `HTTP` → `localhost:80`.

Open https://skillpouch.net — done.

## Day to day

|                   |                                                                                          |
| ----------------- | ---------------------------------------------------------------------------------------- |
| Deploy            | push/merge to `main`; the Pi picks it up within 2 minutes                                |
| Watch a deploy    | `journalctl -fu skillpouch-update`                                                       |
| Deploy now        | `deploy/pi/update.sh --force`                                                            |
| Roll back the API | `cd deploy && COMPOSE_FILE=compose.yaml:pi/compose.pi.yaml scripts/rollback.sh`          |
| Stop auto-deploys | `sudo systemctl disable --now skillpouch-update.timer`                                   |
| Logs              | `cd deploy && docker compose --env-file env/stack.env logs -f api-blue api-green worker` |
| Backup            | `deploy/scripts/backup.sh`                                                               |
