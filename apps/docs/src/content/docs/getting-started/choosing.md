---
title: Choosing a pouch and assistants
description: Which pouch a computer syncs, how the first sync treats what's already there, and which assistants and kinds sync.
---

A **pouch** is one encrypted set of instructions, skills, agents, commands,
MCP servers, hooks and plugins. You can have several (for example work and
personal), and **each computer syncs one pouch at a time**. Switch later on
the dashboard's **Pouches** tab.

## The first sync

After you pick a pouch, the dashboard asks how to start.

**An empty pouch** starts from one assistant's setup, or from nothing:

- _Start from an assistant_: its setup is copied into the pouch. The
  assistant keeps working as before.
- _Nothing from this computer_: the pouch starts empty. Add skills, agents
  and MCP servers in the web app.

**A pouch that already has items** offers three choices:

| Choice                | What happens                                                                                         |
| --------------------- | ---------------------------------------------------------------------------------------------------- |
| **Use the pouch**     | This computer gets the pouch's items. Its own copies are backed up, then replaced.                   |
| **Merge both**        | The pouch keeps its items and gets this computer's too. Same name, different content: both are kept. |
| **Use this computer** | The pouch is replaced with what's on this computer, for every computer that syncs it.                |

Nothing is deleted without a backup: files that get replaced are copied to
`~/.skillpouch/backups/` first.

## What syncs on this computer

Next, choose the assistants and kinds this computer syncs. Everything is on
unless you turn it off. The kinds are:

- Instructions
- Skills
- Agents
- Commands
- MCP servers
- Hooks
- Plugins

The choice belongs to this computer only; other computers choose for
themselves. Change it later on the dashboard's **Sync** tab or with
[`skillpouch select`](/cli/select/):

```sh
skillpouch select                 # list what's on and off
skillpouch select --off hooks     # stop putting hooks into assistants here
skillpouch select --on codex      # sync Codex again
```

Turning an assistant or a kind off hands its items back right away:
SkillPouch's links become ordinary files, so nothing stops working.

## How items reach your assistants

The pouch is kept as ordinary files under `~/.skillpouch/`. SkillPouch
links each assistant's folders to those files, so editing a skill in any
assistant edits the pouch. Where a link can't work, the assistant gets a copy
instead (commands in Gemini's TOML format, and files on Windows without
Developer Mode); edits to a copy are brought back before each sync. MCP
servers, hooks and plugins are written into the assistants' config files,
changing only the entries SkillPouch added.

Agents and commands are translated into each assistant's own format: its
front matter, tool names and argument placeholder. What goes where is listed
per [assistant](/assistants/).
