---
title: Background sync
description: How SkillPouch keeps a computer in sync on its own, and how it runs on Linux, macOS and Windows.
---

Once a computer is set up, SkillPouch syncs on its own. You don't need to
run [`skillpouch sync`](/cli/sync/); it's there for when you want a sync
right now and to see what it did.

## What it does

- **Changes from other computers** arrive within moments: the background
  sync keeps a request open to the server, which answers as soon as
  something changes.
- **Changes on this computer** are noticed within a couple of seconds: it
  checks the pouch folder and the assistants' folders and config files,
  waits half a second for editors to finish saving, then syncs.
- **A full sync** runs at least every 5 minutes as a safety net.
- **Token usage** from the assistants' local logs is counted every 10
  minutes, so the web app's Usage page stays current.
- **Desktop notifications** tell you once about something that needs you:
  an item changed in two places, or a sign-in that stopped working.

When the network or the server is away, it retries with growing pauses and
catches up when they're back.

One background sync runs per SkillPouch folder. It starts over on its own
when a newer SkillPouch is installed or this computer logs in to another
server.

## How it runs

| System  | Started as                                                                                     |
| ------- | ---------------------------------------------------------------------------------------------- |
| Linux   | A systemd user service, `~/.config/systemd/user/skillpouch.service`                            |
| macOS   | A launchd agent, `~/Library/LaunchAgents/net.skillpouch.sync.plist`                            |
| Windows | An entry in the current user's Run key (`HKCU\…\CurrentVersion\Run`), started without a window |

All three start it again when you log in. Where there's no service manager
(a Linux system without a user systemd, for example) it runs as a process
of its own until the computer restarts. Running `skillpouch` (or a command
like `skillpouch status`) starts it again.

A one-off run from a temporary download (`npx skillpouch`) can't install a
background sync, because the program is gone once the cache is cleared.
Install SkillPouch with `npm i -g skillpouch` (or pnpm or bun) first.

## Commands

```sh
skillpouch daemon status   # is it running, and how did the last sync go?
skillpouch daemon stop     # stop it, and don't start it at login
skillpouch daemon start    # start it, and start it at login again
```

A background sync you stopped stays stopped: commands won't start it
behind your back until you run `skillpouch daemon start` or set the
computer up again.

## The log

The background sync writes to `~/.skillpouch/logs/sync.log`. The log is
started over once it passes 1 MB. `skillpouch daemon status` shows where it
is.
