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
| Cursor        | `cursor`      | `~/.cursor`                                           |
| Windsurf      | `windsurf`    | `~/.codeium/windsurf`                                 |
| Qwen Code     | `qwen-code`   | `~/.qwen`                                             |
| Factory Droid | `factory`     | `~/.factory`                                          |
| Crush         | `crush`       | `~/.config/crush` (or `$XDG_CONFIG_HOME/crush`)       |

The id is what [`skillpouch select`](/cli/select/) and
[`skillpouch unlink`](/cli/unlink/) take.

## What goes where

Paths are relative to the assistant's folder unless they start with `~`. A
dash means SkillPouch doesn't put that kind into the assistant.

| Assistant     | Instructions               | Skills              | Agents    | Commands            |
| ------------- | -------------------------- | ------------------- | --------- | ------------------- |
| Claude Code   | `CLAUDE.md`                | `skills/`           | `agents/` | `commands/`         |
| Codex         | `AGENTS.md`                | `~/.agents/skills/` | –         | `prompts/`          |
| OpenCode      | `AGENTS.md`                | `skills/`           | `agents/` | `commands/`         |
| Gemini CLI    | `GEMINI.md`                | `skills/`           | `agents/` | `commands/` (TOML)  |
| Antigravity   | `~/.gemini/GEMINI.md`      | `skills/`           | `agents/` | –                   |
| Copilot CLI   | `copilot-instructions.md`  | `skills/`           | `agents/` | –                   |
| Cursor        | –                          | `skills/`           | –         | `commands/`         |
| Windsurf      | `memories/global_rules.md` | –                   | –         | `global_workflows/` |
| Qwen Code     | `QWEN.md`                  | –                   | `agents/` | `commands/` (TOML)  |
| Factory Droid | –                          | `skills/`           | `droids/` | `commands/`         |
| Crush         | `CRUSH.md`                 | `skills/`           | –         | –                   |

| Assistant     | MCP servers                         | Hooks                                           | Plugins                              |
| ------------- | ----------------------------------- | ----------------------------------------------- | ------------------------------------ |
| Claude Code   | `~/.claude.json`                    | `settings.json`                                 | `settings.json`                      |
| Codex         | `config.toml`                       | `hooks.json`                                    | –                                    |
| OpenCode      | `opencode.json` or `opencode.jsonc` | –                                               | the `plugin` list in `opencode.json` |
| Gemini CLI    | `settings.json`                     | `settings.json`                                 | –                                    |
| Antigravity   | `mcp_config.json`                   | –                                               | –                                    |
| Copilot CLI   | `mcp-config.json`                   | `hooks/skillpouch.json`                         | –                                    |
| Cursor        | `mcp.json`                          | `hooks.json`                                    | –                                    |
| Windsurf      | `mcp_config.json`                   | `hooks.json`                                    | –                                    |
| Qwen Code     | `settings.json`                     | `settings.json`                                 | –                                    |
| Factory Droid | `mcp.json`                          | `hooks.json` if it exists, else `settings.json` | `settings.json`                      |
| Crush         | –                                   | –                                               | –                                    |

## Notes per assistant

- **Codex** reads skills from the shared `~/.agents/skills/` folder as well
  as `~/.codex/skills/`; SkillPouch links them into the shared one.
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
