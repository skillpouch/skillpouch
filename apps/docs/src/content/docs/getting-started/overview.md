---
title: How SkillPouch works
description: What SkillPouch is, the problem it solves, and how the CLI, pouches, the web app and end-to-end encryption fit together.
---

SkillPouch keeps your AI coding setup the same on every computer and in
every assistant: instructions, skills, agents, commands, MCP servers, hooks,
plugins and assistant settings. You write an item once, and each assistant
gets it in its own format and folder. Everything is end-to-end encrypted,
and the project is open source under the AGPL-3.0.

## The problem

Each AI coding assistant keeps its setup in its own place and format:
Claude Code reads `~/.claude/CLAUDE.md`, Codex reads `~/.codex/AGENTS.md`,
Gemini CLI reads `~/.gemini/GEMINI.md`, and each one stores MCP servers in a
different config file. With two assistants or two computers, the same
instructions, skills and MCP servers are copied by hand, drift apart, and
are missing on the next new machine.

## The parts

- **A pouch** is one encrypted set of items. You can have several (for
  example work and personal); each computer syncs one at a time. See
  [Choosing a pouch and assistants](/getting-started/choosing/).
- **The CLI** (`skillpouch`) runs on each computer. It finds the
  [supported assistants](/assistants/) in your home folder, links their
  folders to the pouch's files under `~/.skillpouch/`, and runs a
  [background sync](/cli/background-sync/) that starts with the computer.
  Running `skillpouch` on its own opens a terminal dashboard.
- **The web app** at [app.skillpouch.net](https://app.skillpouch.net) shows
  every item in your browser, lets you edit items, share one by link, add
  items from marketplaces, and [settle conflicts](/web/conflicts/).
- **The server** stores and relays ciphertext. It can't read your items or
  recover them for you. See [Security](/security/).

## One item, every assistant

Items are stored once and translated for each assistant:

- Instructions become `CLAUDE.md`, `AGENTS.md`, `GEMINI.md`,
  `copilot-instructions.md` and so on.
- Agents and commands get each assistant's front matter, tool names and
  argument placeholder; Gemini CLI and Qwen Code get TOML commands.
- MCP servers, hooks and plugins are written into each assistant's config
  file, changing only the entries SkillPouch added.
- Assistant settings (models, providers, permissions, display preferences)
  sync as one Settings item per assistant. Credential files are never
  synced.

The full map is in [Supported assistants](/assistants/).

## A typical setup

```sh
npm i -g skillpouch     # or pnpm / bun
skillpouch login        # approve this computer in the browser
```

On the first computer you pick a pouch and start it from one assistant's
setup. On the next computer you pick the same pouch and choose **Use the
pouch** or **Merge both**; files that would be replaced are backed up to
`~/.skillpouch/backups/` first. From then on a change on one computer
reaches the others within moments while they are online. See
[A second computer](/getting-started/second-computer/).

## Encryption in one paragraph

Files, file names and pouch names are encrypted on your computer or in
your browser before upload. Unlock secrets (master password, Recovery Key,
passkeys) derive keys on your device, and each computer has its own key
pair that never leaves it. Clients verify signatures and refuse a server
that tampers with data. If you lose every unlock secret and every trusted
device, nobody can recover the data. Details are in [Security](/security/).

## Cost and source

There is a free plan, and every plan has every feature; paid plans add
pouches and storage. The server, web app and these docs are at
[github.com/skillpouch/skillpouch](https://github.com/skillpouch/skillpouch),
and the CLI is at
[github.com/skillpouch/skillpouch-cli](https://github.com/skillpouch/skillpouch-cli).
You can also [run your own server](/self-hosting/).
