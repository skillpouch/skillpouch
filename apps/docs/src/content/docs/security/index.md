---
title: Security
description: How SkillPouch protects your content, what the service can see, and how to report a vulnerability.
---

## Security model

- **Content is encrypted on your devices.** The CLI and the web app encrypt
  pouch content, file names and pouch names before upload. The server
  stores and relays ciphertext and never holds content keys.
- **Who belongs to an account is a signed, append-only chain.** Every
  client replays and verifies this roster itself, so the server can't add a
  device or swap keys unnoticed. Pouch keys reach each member in envelopes
  sealed to that member's key.
- **Clients refuse a lying server.** Signatures, the roster's order, file
  IDs and encryption are checked on the client. Tampering is refused (the
  web app also reports it to your account's security events), and a computer only
  deletes a local item when it sees a deletion signed by one of your
  devices.
- **Unlock secrets stay with you.** The master password, Recovery Key and
  passkeys derive keys on your device. The per-account pepper mixed into
  the password derivation is stored only sealed with a server key that is
  kept out of the database and its backups.
- **Device keys never leave the computer.** `skillpouch login` creates a
  signing and an encryption key pair on the computer; a signed-in browser
  approves it, and pouch keys arrive sealed to that device. Every request
  proves possession of the signing key (DPoP).
- **Account data is isolated in the database** with row-level security per
  account.
- **Sensitive actions need a fresh sign-in.** Revoking a device, deleting a
  pouch, changing passkeys, unlock secrets or security settings and deleting
  the account ask you to sign in again if your last sign-in is older than 10
  minutes. The web app opens a small sign-in window for GitHub or Google and
  waits; once you're done it carries on with the action, without reloading
  the page. If your browser blocks the window, allow pop-ups for the site or
  sign in in the same tab instead.

### What the service can see

Account and device identifiers, the email address you sign in with, sizes
and timing of uploads, the number of pouches and files, plan and billing
state, IP addresses and user agents, and the token-usage counts the CLI
reports (counts only, never prompt text).

### Trade-offs to know

- **The web app is served by the service**, so you trust it each time it
  loads. The CLI doesn't run code delivered by the server; it updates from
  npm.
- **The CLI keeps its keys and tokens in a file**,
  `~/.skillpouch/state/credentials.json` (mode `0600` in a `0700` folder).
  Anything running as your user can read it; operating-system keychains
  aren't used yet. `skillpouch logout` removes it.
- **A server can still withhold data.** It can't read or forge content, but
  it can leave out a deletion it received. A computer that never saw that
  deletion then uploads its copy again, and the item comes back.
- **The cryptographic code is open** in
  [`packages/crypto`](https://github.com/skillpouch/skillpouch/tree/main/packages/crypto)
  and the CLI's
  [`sp-crypto`](https://github.com/skillpouch/skillpouch-cli/tree/main/crates/sp-crypto).
  Review it before relying on SkillPouch for a sensitive threat model.

## Reporting a vulnerability

Please report privately, not in a public issue, pull request or Discord
channel.

1. **Preferred:** GitHub private vulnerability reporting. Open the
   **Security** tab of
   [`skillpouch`](https://github.com/skillpouch/skillpouch/security) or
   [`skillpouch-cli`](https://github.com/skillpouch/skillpouch-cli/security)
   and choose **Report a vulnerability**. Either repository is fine.
2. **Or** tell us in the [Discord server](https://discord.gg/u8eEJZEGhc)
   that you've found a security issue. Leave out the details there; we'll
   take it from you privately.

Include:

- the affected part (API, web app, CLI, encryption formats, the
  self-hosting stack) and its version or commit; for the CLI,
  `skillpouch --version`, your operating system and how you installed it
- what an attacker can do, and from which position: another user, a
  network observer, a malicious or compromised server, someone with access
  to a device
- steps to reproduce or a proof of concept
- whether you'd like to be credited, and under which name

Please don't include other people's data. Use your own accounts.

### What happens next

This is a small project, so we can't promise fixed response times. We aim
to acknowledge your report within a few days, tell you whether we can
reproduce it and how serious we think it is, keep you updated while we work
on a fix, agree on a disclosure date with you, and credit you in the
advisory unless you prefer not. Fixed vulnerabilities are published as
GitHub security advisories.

### Supported versions

| Part                                  | Supported                                        |
| ------------------------------------- | ------------------------------------------------ |
| Hosted service (`app.skillpouch.net`) | Always the current deployment                    |
| API, web app, site                    | The `main` branch; fixes are not backported      |
| CLI                                   | The latest release; it updates itself by default |

Self-hosted servers should run a recent commit of `main`.

### Scope

In scope:

- the end-to-end encryption design and its implementation: key derivation,
  key envelopes, the signed roster, sealed objects, sharing
- the API and worker: authentication, DPoP, sessions, account isolation,
  authorization, rate limits, billing webhooks
- the web app and the CLI, including key storage, the background sync,
  file linking and self-update
- the [self-hosting stack](/self-hosting/) when used as documented

Out of scope:

- attacks that need an already compromised device, browser or operating
  system, administrator rights, or physical access to an unlocked computer
- reading `~/.skillpouch` as the same operating-system user
- denial of service through traffic volume, and spam
- reports from automated scanners without a demonstrated impact
- missing best-practice headers or settings without a concrete attack
- social engineering of SkillPouch users or maintainers
- third-party services (GitHub, Google, Polar, Cloudflare, npm) themselves

What the service can see, described above, is a known design trade-off, not
a vulnerability, but ideas for reducing it are welcome.

### Good faith

We won't pursue or support legal action against anyone who researches and
reports in good faith under this policy: you avoid privacy violations, data
destruction and service disruption, only access data that belongs to you,
stop and report as soon as you find a way to reach someone else's data, and
give us reasonable time to fix the issue before telling others. If you're
unsure whether something is allowed, ask us first.
