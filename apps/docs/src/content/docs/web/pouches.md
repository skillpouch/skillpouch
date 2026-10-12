---
title: Pouches and items
description: Create pouches, add and edit items in the browser, and share an item with a link.
---

The web app at [app.skillpouch.net](https://app.skillpouch.net) shows your
pouches and everything in them. It decrypts them in your browser after you
unlock it.

## Pouches

A pouch is one encrypted set of items. **Pouches** (the start page of the
app) lists them with what they hold, how many computers sync each one and
whether any have [conflicts](/web/conflicts/).

- **New pouch** creates one with a name and an optional description. How
  many you can have depends on your plan.
- **Pouch settings** renames a pouch, changes its description or deletes
  it. Deleting asks first; your computers stop syncing it and remove its
  items. You can't delete your only pouch: create another one first.

Each computer syncs one pouch. Which one is chosen on the computer: in the
dashboard (`skillpouch`) on its **Pouches** tab.

## Inside a pouch

The sidebar has the pouch's **Overview** (computers, last sync, recently
added), one page per kind (Instructions, Skills, Agents, Commands, MCP
Servers, Hooks, Plugins, Settings), Marketplaces, Trash, Conflicts, Shared
links and Pouch settings.

## Adding an item

On a kind's page, add an item:

- **Write it yourself**: starts from a template for that kind (a `SKILL.md`
  with `name` and `description` for a skill, front matter for an agent or
  command, a JSON definition for an MCP server, hook, plugin or assistant
  settings item).
- **From a marketplace**: browse available items in the app.
- **From GitHub**: a repository that is one item is added straight away; a
  repository that holds several is offered as a marketplace to browse. An
  item at the top of a repository takes the repository's name.

A plugin brings only the files a Claude Code plugin is made of:
`.claude-plugin/`, `skills/`, `hooks/`, markdown in `commands/` and
`agents/`, the other standard plugin folders, `.mcp.json`, `.lsp.json`,
`settings.json`, and its README and license, plus any file its
`plugin.json` or hooks point at. Copies kept in the same repository for
other assistants (`.cursor/`, `.opencode/`, `commands/*.toml`, …), docs,
tests and images stay behind.

## Editing

Open an item to see its files. **Edit** opens an editor where you can
change files, add new ones (use `/` for folders, like `scripts/run.sh`),
rename and delete them. Saving encrypts the item in your browser; your
computers get it on their next sync, usually within seconds.

An edit in an assistant on a computer ends up in the same place: the
assistants' folders link to the pouch, so a change there is synced like
one made here.

**Delete** moves the item to the trash and removes it from every computer
that syncs it, on their next sync.

## Trash

**Trash** (below Marketplaces in the sidebar) lists deleted items. Each one
stays there for 7 days; after that its files are removed for good. The ⋯
menu on an item has:

- **Restore**: brings the item back, and your computers get it on their
  next sync. If another item of the same kind has taken its name in the
  meantime, you pick a new name first.
- **Delete permanently**: removes its files now. It can't be restored
  afterwards.

**Empty trash** deletes everything in it permanently.

## Sharing an item

**Share** on an item creates a link to a snapshot of its current version;
later edits aren't shared. The item is encrypted in your browser with a new
key that exists only in the link itself (after the `#`, which browsers don't
send to servers), so SkillPouch can't read what you share. Secret values in
MCP server and hook configs (`env` and `headers`) and assistant settings are
left out; whoever imports them fills them in.

A link expires after 1, 7 or 30 days, or never, and can be limited to one
import. Copy it when it's made: it can't be shown again later. Whoever opens
it signs in, unlocks, and picks the pouch to add the item to.

**Shared links** lists the links made from a pouch. Revoking one stops it
working and deletes its encrypted copy; people who already imported it keep
their copy.
