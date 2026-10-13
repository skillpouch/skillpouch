---
title: Sync Claude Code settings to a second computer
description: Connect another computer to the same pouch so your Claude Code, Codex and Cursor settings, skills, instructions and MCP servers sync to it.
---

Every computer connects the same way: [install the CLI](/getting-started/install/)
and run `skillpouch`.

1. Approve the computer in a browser where you're already signed in and
   unlocked. A browser you trusted on the first computer unlocks on its own.
2. Pick the **same pouch** as on the first computer.
3. Because the pouch already has items, choose how to start:
   - **Use the pouch** if this computer should simply get your setup (its
     own files are backed up to `~/.skillpouch/backups/` first);
   - **Merge both** if this computer has things worth keeping too. Items
     with the same name but different content are both kept.
4. Choose the assistants and kinds this computer syncs.

From then on both computers stay in sync in the background: a change on
one arrives on the other within moments while both are online, and a
computer that was offline catches up when it comes back.

## Edited in two places at once

If the same item changes on two computers before they sync, nothing is
lost: the server keeps both versions as a conflict, and you pick the one to
keep in the web app. Run `skillpouch conflicts` to open the page; see
[Conflicts](/web/conflicts/).

## Connecting from the web app

You can also start from the web app: **Account → Devices → Connect CLI**
shows the install command for npm, pnpm or bun and a one-time
`skillpouch login <token>` command. Run both on the new computer; the token
works once and expires after 10 minutes.

## Removing a computer

Revoke a computer you no longer use under **Account → Devices**. It's signed
out immediately and every pouch gets new keys, so it can't read anything
changed afterwards. See [Devices](/web/devices/).
