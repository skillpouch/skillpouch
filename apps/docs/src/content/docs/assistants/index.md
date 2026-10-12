---
title: Supported assistants
description: The AI assistants SkillPouch finds on a computer, and where each kind of item goes in each one.
---

SkillPouch looks for these assistants in your home folder. An assistant
counts as installed when its folder exists; nothing needs to be configured.

| Assistant     | Id            | Folder                                                |
| ------------- | ------------- | ----------------------------------------------------- |
| Claude Code   | `claude-code` | `~/.claude` (or `$CLAUDE_CONFIG_DIR`)                 |
| Codex         | `codex`       | `~/.codex` (or `$CODEX_HOME`)                         |
| OpenCode      | `opencode`    | `~/.config/opencode` (or `$XDG_CONFIG_HOME/opencode`) |
| Gemini CLI    | `gemini-cli`  | `~/.gemini`                                           |
| Antigravity   | `antigravity` | `~/.gemini/config`                                    |
| Copilot CLI   | `copilot`     | `~/.copilot` (or `$COPILOT_HOME`)                     |
| Cursor        | `cursor`      | `~/.cursor` (or `$CURSOR_CONFIG_DIR`)                 |
| Windsurf      | `windsurf`    | `~/.codeium/windsurf`                                 |
| Qwen Code     | `qwen-code`   | `~/.qwen`                                             |
| Factory Droid | `factory`     | `~/.factory`                                          |
| Crush         | `crush`       | `~/.config/crush` (or `$XDG_CONFIG_HOME/crush`)       |

The id is what [`skillpouch select`](/cli/select/) and
[`skillpouch unlink`](/cli/unlink/) take.

## Settings sync

The CLI keeps one **Settings** item per supported assistant. It syncs these
assistant settings files:

| Assistant     | Synced settings                                                                                                                                                                                                                                                                                                                                                                   |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| OpenCode      | OpenCode 2: `opencode.json` (providers, model, default agent, agents, permissions, sharing, username, compaction, tool output, web search, experimental options) and `cli.json` (theme, keybinds, leader key, scrolling, diffs, prompt, mouse, cursor, animations, attention, session, terminal, tabs). OpenCode 1: the same in its own names, in `opencode.json` and `tui.json`. |
| Claude Code   | `~/.claude/settings.json`: environment, model, model overrides, fallback and advisor models, effort level, extended thinking, fast mode, permissions, API key helper, status line, output style, language, theme and other display preferences, co-author attribution, update channel, cleanup period.                                                                            |
| Codex         | `~/.codex/config.toml`: model and providers, profiles, approval and sandbox policies, reasoning effort/summary, verbosity, OpenAI base URL, TUI, features and web search.                                                                                                                                                                                                         |
| Gemini CLI    | `~/.gemini/settings.json` (general, UI, model, tools, privacy, security auth type) and `~/.gemini/.env`.                                                                                                                                                                                                                                                                          |
| Qwen Code     | `~/.qwen/settings.json`: model providers/protocol, environment, auth, model, general, UI, tools and proxy.                                                                                                                                                                                                                                                                        |
| Copilot CLI   | `~/.copilot/settings.json`: model, theme and display preferences, notifications, allowed and denied URLs, permission mode, status line, updates and experimental options. Not trusted folders, hooks, the proxy or IDE settings. Copilot's own model provider (BYOK) is set with environment variables, which aren't synced.                                                      |
| Crush         | `crush.json`: providers, models, options (not `data_directory`), permissions and tools.                                                                                                                                                                                                                                                                                           |
| Factory Droid | `~/.factory/settings.json`: model, reasoning effort, custom models and session defaults.                                                                                                                                                                                                                                                                                          |
| Cursor        | The Cursor CLI's `cli-config.json` (in `~/.cursor`, `$CURSOR_CONFIG_DIR`, or `$XDG_CONFIG_HOME/cursor` on Linux): model, max mode, approval mode, permissions, sandbox, editor and display preferences, notifications, hints, steering, rewind and attribution. Not `version`, network options, or the editor's own settings.                                                     |
| Antigravity   | The Antigravity CLI's `~/.gemini/antigravity-cli/settings.json`: color scheme, tool permission, artifact review policy, agent mode, notifications, tips, editor mode, terminal sandbox, telemetry, verbosity, status line, title and permissions. Not trusted workspaces or credit use.                                                                                           |

Windsurf settings are not supported: Windsurf keeps its preferences in a
binary file, not a text config. MCP servers,
hooks and plugins are synced as their own item kinds, not as settings. Credential
files such as `auth.json`, `.credentials.json` and `oauth_creds.json` are never
synced.

OpenCode 1 and 2 computers share providers, models, agents, permissions and
terminal preferences; keybinds, and options only one version has, stay on the
computers of that version. When a computer meets an assistant's settings for
the first time (a new computer, or an assistant installed again), the pouch's
values replace its defaults; after that, the last edit wins.

Settings are synced end-to-end encrypted. Secret values remain in your pouch,
but are removed from share links; recipients fill them in when importing.
Deleting a setting or entry locally stops it on that computer but keeps it in
the pouch. Use [`skillpouch settings`](/cli/settings/) to list entries, bring one back
(`include <assistant> <entry>`) or stop syncing one (`exclude`). Uninstalling
and later reinstalling an assistant syncs its settings again. A newly installed
assistant gets your settings automatically; turn settings off on a computer with
`skillpouch select --off settings`, or one assistant with
`skillpouch select --off <id>`.

## What goes where

Paths are relative to the assistant's folder unless they start with `~`. A
dash means SkillPouch doesn't put that kind into the assistant.

### Instructions and skills

| Assistant     | Instructions               | Skills              |
| ------------- | -------------------------- | ------------------- |
| Claude Code   | `CLAUDE.md`                | `skills/`           |
| Codex         | `AGENTS.md`                | `~/.agents/skills/` |
| OpenCode      | `AGENTS.md`                | `skills/`           |
| Gemini CLI    | `GEMINI.md`                | `skills/`           |
| Antigravity   | `~/.gemini/GEMINI.md`      | `skills/`           |
| Copilot CLI   | `copilot-instructions.md`  | `skills/`           |
| Cursor        | –                          | `skills/`           |
| Windsurf      | `memories/global_rules.md` | –                   |
| Qwen Code     | `QWEN.md`                  | `~/.agents/skills/` |
| Factory Droid | –                          | `skills/`           |
| Crush         | `CRUSH.md`                 | `skills/`           |

### Agents and commands

| Assistant     | Agents    | Commands            |
| ------------- | --------- | ------------------- |
| Claude Code   | `agents/` | `commands/`         |
| Codex         | –         | `prompts/`          |
| OpenCode      | `agents/` | `commands/`         |
| Gemini CLI    | `agents/` | `commands/` (TOML)  |
| Antigravity   | `agents/` | –                   |
| Copilot CLI   | `agents/` | –                   |
| Cursor        | –         | `commands/`         |
| Windsurf      | –         | `global_workflows/` |
| Qwen Code     | `agents/` | `commands/` (TOML)  |
| Factory Droid | `droids/` | `commands/`         |
| Crush         | –         | –                   |

### MCP servers, hooks and plugins

| Assistant     | MCP servers                         | Hooks                                           | Plugins                                                        |
| ------------- | ----------------------------------- | ----------------------------------------------- | -------------------------------------------------------------- |
| Claude Code   | `~/.claude.json`                    | `settings.json`                                 | `settings.json`                                                |
| Codex         | `config.toml`                       | `hooks.json`                                    | –                                                              |
| OpenCode      | `opencode.json` or `opencode.jsonc` | –                                               | the `plugins` list in `opencode.json` (`plugin` in OpenCode 1) |
| Gemini CLI    | `settings.json`                     | `settings.json`                                 | –                                                              |
| Antigravity   | `mcp_config.json`                   | –                                               | –                                                              |
| Copilot CLI   | `mcp-config.json`                   | `hooks/skillpouch.json`                         | –                                                              |
| Cursor        | `mcp.json`                          | `hooks.json`                                    | –                                                              |
| Windsurf      | `mcp_config.json`                   | `hooks.json`                                    | –                                                              |
| Qwen Code     | `settings.json`                     | `settings.json`                                 | –                                                              |
| Factory Droid | `mcp.json`                          | `hooks.json` if it exists, else `settings.json` | `settings.json`                                                |
| Crush         | `crush.json`                        | –                                               | –                                                              |

### Plugin folders

A plugin added as a folder (a Claude Code plugin, for example from GitHub or
a marketplace) is stored once, in `~/.skillpouch/current/plugins/<name>`.
Claude Code installs it as a plugin. Every other assistant gets its parts
instead, each where the tables above put that kind: its skills, agents,
commands, hooks and MCP servers. An assistant without a place for a kind
doesn't get those parts.

- Hooks and MCP servers get `CLAUDE_PLUGIN_ROOT` set to the plugin's folder,
  so the scripts they run are found. On Windows, hooks get the folder
  written into their command instead, without the variable.
- If a part has the same name as another item, or as a part of another
  plugin, the other one stays and the sync reports the part it left out.
- Edits to a skill, agent or command part go back into the plugin. A plugin's
  hook or MCP server edited in an assistant's config is put back as the
  plugin has it. To stop using a part, remove the plugin; a part deleted from
  one assistant is put back by the next sync.
- Factory Droid only loads plugins it installed itself, so it gets the parts
  too.
- Codex asks you to trust new hooks before it runs them.

## Notes per assistant

- **Codex** reads skills from the shared `~/.agents/skills/` folder as well
  as `~/.codex/skills/`; SkillPouch links them into the shared one. **Qwen
  Code** reads the shared folder too.
- **OpenCode** also reads the older singular folders (`skill/`, `agent/`,
  `command/`); SkillPouch finds items there too.
- **Antigravity** shares its global rules file with Gemini CLI
  (`~/.gemini/GEMINI.md`), so one instructions file serves both. Its app
  folders (`~/.gemini/antigravity`, `antigravity-ide`, `antigravity-cli`)
  show that it's installed before `~/.gemini/config` exists. Skills in the
  IDE's older `~/.gemini/antigravity/skills/` are found too.
- **Copilot CLI** agents may be named `<name>.agent.md`; they're read as
  `<name>`. Hooks go into a file of SkillPouch's own in `hooks/`, so your
  other hook files stay as they are.
- **Gemini CLI** and **Qwen Code** commands are TOML files, so they get a
  converted copy instead of a link. Edits to the copy are brought back into
  the pouch before each sync.

## Formats

Agents and commands are stored in the pouch in Claude Code's format and
translated for each assistant: its front matter, tool names and the
placeholder for arguments (`$ARGUMENTS`, or `{{args}}` in TOML commands).
MCP servers are written in each assistant's own config format; SkillPouch
changes only the entries it added and leaves the rest of the file alone.

## Folders in a git checkout

If an assistant's folder is part of a git checkout (for example a dotfiles
repository), SkillPouch only reads it and never writes there, so the
checkout stays clean.

## Choosing assistants per computer

Every assistant found is synced unless you turn it off for this computer:

```sh
skillpouch select --off cursor
skillpouch unlink --assistant windsurf
```

See [Choosing a pouch and assistants](/getting-started/choosing/).
