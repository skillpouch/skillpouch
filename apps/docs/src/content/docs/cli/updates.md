---
title: Updates
description: How SkillPouch keeps itself up to date, and how to turn that off.
---

Installed with npm, pnpm or bun, SkillPouch updates itself: it asks the npm
registry for the latest version and installs it with the same package
manager you used.

## When it looks

| Where                                         | How often it asks the registry                                                                                |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| The dashboard (`skillpouch`)                  | Every time it opens. It opens at once and updates behind it, then offers to restart.                          |
| The [background sync](/cli/background-sync/)  | Hourly. It installs the new version and starts over with it.                                                  |
| Commands at a terminal (`skillpouch sync`, …) | At most every 6 hours, so commands stay quick. It updates first, then runs your command with the new version. |

Commands run from a script or a pipe, `skillpouch status --json`,
`skillpouch logout`, `skillpouch unlink` and the `daemon` commands never
update. Pre-releases are never installed. A version that failed to install
is tried again a day later; until then the dashboard says it's out and shows
the command to install it by hand.

## What's never updated

- **Builds from source** (`cargo build`): only copies installed by a package
  manager update themselves.
- **One-off runs** with `npx`, `pnpm dlx` or `bunx`.

## Windows

Windows won't replace a program while it runs. The background sync doesn't
update itself there; the dashboard and commands stop the background sync,
install the new version and start it again. If SkillPouch is still in use
elsewhere, it says so: quit it and run the install command it shows, for
example `npm i -g skillpouch`.

## Turning updates off

In [`config.toml`](/cli/configuration/):

```toml
auto_update = false
```

or for one shell or service, with any non-empty value:

```sh
export SKILLPOUCH_NO_UPDATE=1
```

Then update by hand with the command you installed it with:

```sh
npm i -g skillpouch
```

## Permission errors

If the package manager needs administrator rights to install globally
(npm with a system-wide prefix, for example), the update fails and
SkillPouch prints the package manager's error and the command to run by
hand. Installing Node with a version manager, or setting an npm prefix in
your home folder, avoids this.
