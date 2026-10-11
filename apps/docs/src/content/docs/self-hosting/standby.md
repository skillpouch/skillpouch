---
title: Standby and failover
description: Keep a warm standby server and promote it when the primary fails, for servers behind Cloudflare Tunnel.
---

`deploy/scripts/failover.sh` keeps a second server as a warm standby and
promotes it when the primary dies. It's for servers behind
[Cloudflare Tunnel](/self-hosting/tunnel/) and runs on the **standby**, from
its checkout of the repository.

:::caution[Not rehearsed in production yet]
The scripts have only been run against throwaway containers. Rehearse on
two spare machines (or staging) before you depend on them, and again after
larger changes to the stack.
:::

## How it works

- **Database:** the standby's Postgres is a streaming replica of the
  primary's (hot standby, read-only). It connects through an SSH link, so
  the primary's Postgres stays unpublished. `setup` creates a replication
  login and a slot named `replica_<hostname>` on the primary, and caps the
  WAL a slot may hold back at 8 GB (`STANDBY_MAX_WAL`) so a standby that
  stays offline can't fill the primary's disk. Past the cap the standby
  needs `failover.sh setup --rebuild`.
- **Files:** with `BLOB_DRIVER=s3` both servers use the same bucket and
  nothing is copied. With the volume, missing files are copied every few
  minutes (they never change once stored).
- **Config:** `env/*.env` and `secrets/` are copied from the primary; a
  standby needs the same database passwords, `pepper_key` and
  `jwt_signing_key`. The tunnel token comes from `env/tunnel.env` or the
  primary's `cloudflared` service.
- **Release:** the API image the primary runs is copied (or pulled, or
  built for another CPU architecture from the same commit), and so is the
  live web release.
- **Cutover:** the standby runs a tunnel connector with the same token.
  Cloudflare sends requests to any connected connector of a tunnel, so the
  standby answers as soon as it connects. No DNS change.
- **Write pause:** the same switch as the admin dashboard's write pause.
  Writes wait up to 10 seconds, then get a retryable
  [`maintenance_write_pause`](/errors/maintenance_write_pause/); reads keep
  working.

Everything privileged goes through Docker, so no sudo is needed, except to
stop a `cloudflared` installed as a system service.

## Requirements

- The standby is prepared like the primary (Docker, the repository cloned,
  the user in the `docker` group, the data volume at the same `DATA_ROOT`),
  but **without** the tunnel setup's last steps: no `cloudflared service
install`, no Actions runner and no update timer. Those would serve or
  deploy from it.
- Keep its checkout on a recent `main`; the scripts don't update it.
- SSH from the standby to the primary. The first `setup` creates
  `deploy/standby/id_ed25519` and prints the `ssh-copy-id` command that
  authorizes it. That key can use Docker on the primary, which is
  root-equivalent: keep `deploy/standby/` private (git ignores it). The
  primary's sshd must allow TCP forwarding (on by default on Debian and
  Ubuntu).
- Both servers run the same Postgres major version.

## Set up a warm standby

On the standby:

```sh
deploy/scripts/failover.sh setup --primary deploy@primary.example --dry-run
deploy/scripts/failover.sh setup --primary deploy@primary.example
deploy/scripts/failover.sh status
```

`setup` copies config and secrets, sets up replication, copies the database,
the release and the files, and installs a cron job that runs
`failover.sh sync` every 5 minutes (`--every N` to change it). It asks before
replacing a database on the standby and refuses one that holds accounts
(`--replace-local-database` overrides). Running it again is safe.

Other options: `--port` (SSH port), `--peer-dir` (the checkout on the
primary, default the same path), `--yes`.

`status` shows replication, how far the standby is behind, the slot on the
primary, the last file sync and whether the primary and the public URL
answer. The sync log is `deploy/standby/sync.log`.

**What a failover can lose:** replication is asynchronous, so the last
moments before a crash may not have reached the standby (`status` shows the
lag). With the volume, files uploaded since the last sync can be missing
too.

## Fail over

When the primary is gone, on the standby:

```sh
deploy/scripts/failover.sh promote --dry-run
deploy/scripts/failover.sh promote
```

It refuses while the primary still answers (use
[Moving to a new server](/self-hosting/migrate-host/) for a planned move;
`--force` takes over anyway and stops the primary first if it can reach it).
It promotes Postgres, turns the write pause off, starts the API, worker and
Caddy with the copied release and connects the tunnel. If no release was
copied, deploy afterwards with `deploy/tunnel/update.sh --force`.

## Afterwards

1. **Fence the old server before it comes back.** It would reconnect to
   the same tunnel with old data. As soon as SSH works:

   ```sh
   deploy/scripts/failover.sh fence --host deploy@old.example
   ```

   This stops its tunnel connector, API and worker and turns on the write
   pause in its database. The surest fence is a new tunnel: create one in
   Cloudflare, move the public hostname to it, put the new token in
   `env/tunnel.env` on the new primary and recreate its `cloudflared`
   container.

2. Move deploys: install the Actions runner on the new primary
   ([step 5 of the tunnel guide](/self-hosting/tunnel/#5-deploy-from-github-actions))
   and remove the old one.
3. Set up a new standby, for example the repaired old server:
   `failover.sh setup --primary <new primary>` there.
