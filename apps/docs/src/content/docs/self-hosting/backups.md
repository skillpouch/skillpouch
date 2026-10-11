---
title: Backups
description: Back up the database and files with restic, and restore them on another machine.
---

`deploy/scripts/backup.sh` writes a database dump and the files to a
[restic](https://restic.net) repository:

```sh
RESTIC_REPOSITORY=<repository> RESTIC_PASSWORD_FILE=<file> deploy/scripts/backup.sh
```

- The database is dumped with `pg_dump` into `/srv/skillpouch/backups`;
  local dumps older than two days are deleted.
- The dump and the files folder go to restic. Files never change once
  stored, so later backups are small.
- restic keeps 14 daily, 8 weekly and 12 monthly snapshots.

Run it every night with a systemd timer or cron job.

## What isn't backed up

- **`pepper_key` and `jwt_signing_key`.** Keep them offline, apart from the
  backups ([Configuration](/self-hosting/configuration/#secrets)). A backup
  without them can't restore a working server.
- **Files in a bucket** (`BLOB_DRIVER=s3`). Back the bucket up with the
  provider's tools or `rclone`.

## Restoring or moving by hand

On the new machine:

1. Set it up as usual ([Cloudflare Tunnel](/self-hosting/tunnel/) or
   [VPS](/self-hosting/vps/)).
2. Copy `deploy/secrets/` and `deploy/env/` from the old machine or your
   offline copy.
3. Attach the old data volume, or restore the files folder and the
   database dump from restic.
4. Deploy, then point your hostname at the new machine.

For a move without downtime, see
[Moving to a new server](/self-hosting/migrate-host/).
