---
title: Devices
description: The computers and browsers that can open your pouches, connecting a new computer, and revoking one.
---

**Account → Devices** lists everything that can open your pouches:

- **Computers** running the CLI, with the pouch each syncs and whether it's
  up to date;
- **Browsers** you unlocked, including this one;
- **Revoked** devices, folded away.

## Connecting a computer

**Connect CLI** shows how to install SkillPouch with npm, pnpm or bun and a
one-time command to run on the new computer:

```sh
skillpouch login sp_lt_…
```

The token works once and expires after 10 minutes. The dialog notices when
the computer has connected. You can also just run `skillpouch` on the
computer and approve it in the browser; see
[First run](/getting-started/first-run/).

## Renaming

A device's name is only a label in the web app; renaming it doesn't change
anything on the computer. To choose the name when connecting, use
`skillpouch login --name "work laptop"` or `device_name` in
[`config.toml`](/cli/configuration/).

## Revoking

Revoke a computer or browser you no longer use, or one you lost:

- it's signed out immediately;
- every pouch gets new keys, so it can't read anything changed from then on;
- files already on that computer stay there.

Revoking the browser you're using signs you out there; next time it unlocks
with your master password, a passkey or the Recovery Key.

A revoked computer that tries to sync is told so. To connect it again, run
`skillpouch logout`, then `skillpouch login` on it.

## Trusted browsers

A browser you unlocked stays unlocked until it goes unused for longer than
the trust window, 30 days unless you change it under **Account → Security**
(7 to 90 days). After that it asks to be unlocked again.
