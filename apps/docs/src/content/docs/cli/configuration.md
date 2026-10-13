---
title: CLI configuration
sidebar:
  label: Configuration
description: The SkillPouch folder, config.toml and the environment variables the CLI reads.
---

## The SkillPouch folder

Everything the CLI keeps is in one folder: `~/.skillpouch`, or the folder
in `SKILLPOUCH_HOME`.

| Path            | What                                                                      |
| --------------- | ------------------------------------------------------------------------- |
| `config.toml`   | Your settings (below).                                                    |
| `state/`        | This computer's keys and sign-in (`credentials.json`) and the sync state. |
| `pouches/<id>/` | The pouch this computer syncs, as ordinary files.                         |
| `current`       | A link to the pouch in use; the assistants' links point through it.       |
| `backups/`      | Files the pouch replaced, by time, before anything was overwritten.       |
| `logs/sync.log` | The [background sync](/cli/background-sync/)'s log.                       |
| `run/`          | Lock files.                                                               |

On macOS and Linux, SkillPouch makes its settings, keys and state readable
only by your user.

## `config.toml`

Every setting is optional; a missing file means the defaults.

```toml
# The server. Default: https://app.skillpouch.net
api_url = "https://skillpouch.example.com"

# The name on the Devices page. Default: this computer's name.
device_name = "work laptop"

# false: SkillPouch never updates itself. Default: on.
auto_update = false

# What this computer leaves out. Default: nothing.
[sync]
skip_assistants = ["cursor"]
skip_kinds = ["hook"]
```

You rarely edit `[sync]` by hand: [`skillpouch select`](/cli/select/) and
the dashboard's **Sync** tab write it. The kinds are `instructions`,
`skill`, `agent`, `command`, `mcp_server`, `hook` and `plugin`. The choice
is this computer's own; other computers choose for themselves.

## Environment variables

| Variable               | Effect                                                                              |
| ---------------------- | ----------------------------------------------------------------------------------- |
| `SKILLPOUCH_API_URL`   | The server, overriding `api_url`.                                                   |
| `SKILLPOUCH_HOME`      | The SkillPouch folder instead of `~/.skillpouch`.                                   |
| `SKILLPOUCH_NO_UPDATE` | Any non-empty value turns [updates](/cli/updates/) off, like `auto_update = false`. |
| `NO_COLOR`             | Output without colours (also the case when it goes to a pipe).                      |

The background sync is installed with the same `SKILLPOUCH_HOME` as the
command that started it. It syncs with the server this computer logged in
to, so logging in to another server is all it takes to move it.

## Assistants' own variables

SkillPouch follows the variables the assistants themselves honour:
`CLAUDE_CONFIG_DIR` (Claude Code), `CODEX_HOME` (Codex), `COPILOT_HOME`
(Copilot CLI) and `XDG_CONFIG_HOME` (OpenCode and Crush). See
[Supported assistants](/assistants/).
