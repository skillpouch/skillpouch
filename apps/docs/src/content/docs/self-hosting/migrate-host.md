---
title: Moving to a new server
description: Move a running SkillPouch server to a new machine with a write pause of a few seconds instead of downtime.
---

`deploy/scripts/migrate-host.sh` moves a running server behind
[Cloudflare Tunnel](/self-hosting/tunnel/) to a new machine. Writes pause for
a few seconds; reads keep working throughout. It runs on the **new** server
and builds on [the standby setup](/self-hosting/standby/), so the same
requirements apply.

:::caution[Not rehearsed in production yet]
Rehearse on two spare machines before moving a server people depend on.
:::

```sh
deploy/scripts/migrate-host.sh --from deploy@old.example --dry-run
deploy/scripts/migrate-host.sh --from deploy@old.example
```

## What it does

1. **Prepare:** runs `failover.sh setup`, so the new server becomes a
   streaming standby with the config, release and files. This takes as
   long as the database copy; nothing changes for users.
2. **Check:** replication is streaming, the old server answers, the release
   and tunnel token are here, the files are recent. Then it asks once.
3. **Switch:** stops the old worker, turns on the write pause in the old
   database, waits until writes that started before the pause have
   finished, copies the last files, waits until the new database has
   replayed everything, promotes it, starts the API, connects the tunnel
   here, turns the write pause off and starts the worker. It prints how long
   writes were paused.
4. **Drain:** stops the old server's tunnel connector, API and worker, and
   copies files that finished uploading meanwhile. The old database stays
   as it was, with the write pause on, as a fallback.

If a step fails before the promotion, the pause is lifted and the old
worker restarted: the old server carries on and the new one stays its
standby. After the promotion, the script prints how to finish with
`failover.sh promote --force` and `failover.sh fence`. Running it again
after a finished move stops at the account check instead of replacing the
new database.

## What users notice

Writes are held while the pause lasts, roughly the time the API takes to
start after promotion (about 8 seconds in a test with containers on one
machine).

- Writes held on the new server succeed when the pause ends.
- Writes still waiting on the old server after 10 seconds get a retryable
  error, and clients send them again, now to the new server. Sync
  operations are idempotent, so a retry never applies twice.
- Streaming clients reconnect and continue where they left off.
- Writes that bypass the pause during the switch, like a sign-in or a
  billing webhook, can be lost: a sign-in may have to be repeated, and the
  daily billing check picks up missed subscription changes.

## Afterwards

- If `cloudflared` on the old server is a system service, stopping it
  needs sudo there: either passwordless sudo for the deploy user, or run
  the script in a terminal and type the password when asked.
- Move deploys (the Actions runner or update timer) to the new server.
- The new server's tunnel connector is the `cloudflared` container.
  `update.sh` calls it an orphan, which is harmless. To use a system service
  instead, run `sudo cloudflared service install <token>`, then
  `docker compose --profile cloudflared rm -sf cloudflared` in `deploy/`
  with `COMPOSE_FILE=compose.yaml:tunnel/compose.tunnel.yaml:compose.ops.yaml`.
- Keep the old server as a standby of the new one for a while:
  `failover.sh setup --primary <new server>` there.
