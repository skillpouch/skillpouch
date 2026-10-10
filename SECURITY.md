# Security policy

SkillPouch syncs people's AI coding setups between their computers, so we take
reports about its security seriously. Thank you for helping keep it safe.

## Supported versions

| Component                             | Supported                                        |
| ------------------------------------- | ------------------------------------------------ |
| Hosted service (`app.skillpouch.net`) | Always the current deployment                    |
| This repository (API, web app, site)  | The `main` branch; fixes are not backported      |
| CLI ([`skillpouch-cli`][cli])         | The latest release; see that repository's policy |

Self-hosted instances should run a recent commit of `main`.

## Reporting a vulnerability

Please report privately, not in a public issue, pull request or Discord channel.

1. **Preferred:** GitHub private vulnerability reporting. Open this
   repository's **Security** tab and choose **Report a vulnerability**.
2. **Or** tell us in the [SkillPouch Discord server](https://discord.gg/u8eEJZEGhc)
   that you've found a security issue. Leave out the details there; we'll
   take it from you privately.

If the issue is in the CLI, you can report it in either repository.

### What to include

- the affected component (API, web app, CLI, crypto formats, deploy stack) and
  version or commit
- what an attacker can do, and from which position (another user, a network
  observer, a malicious or compromised server, someone with access to a
  device)
- steps to reproduce or a proof of concept, and any logs or requests that help
- whether you'd like to be credited, and under which name

Please don't include other people's data. Use your own accounts.

### What happens next

This is a small project, so we can't promise fixed response times. We aim to:

- acknowledge your report within a few days
- tell you whether we can reproduce it and how serious we think it is
- keep you updated while we work on a fix, and agree on a disclosure date with
  you
- credit you in the advisory once the fix is out, unless you prefer not

We publish fixed vulnerabilities as GitHub security advisories.

## Scope

In scope:

- the end-to-end encryption design and its implementation: key derivation,
  key envelopes, the signed roster, sealed objects, sharing
  ([`packages/crypto`](packages/crypto), and `crates/sp-crypto` in the CLI)
- the API and worker ([`apps/api`](apps/api)): authentication, DPoP, sessions,
  tenant isolation (row-level security in [`packages/db`](packages/db)),
  authorization, rate limits, billing webhooks
- the web app ([`apps/web`](apps/web)) and the CLI
- the self-hosting stack in [`deploy/`](deploy) when used as documented

Out of scope:

- attacks that need an already compromised device, browser or operating
  system, or physical access to an unlocked computer
- denial of service through traffic volume, and spam
- reports from automated scanners without a demonstrated impact
- missing best-practice headers or settings without a concrete attack
- social engineering of SkillPouch users or maintainers
- third-party services (GitHub, Google, Polar, Cloudflare) themselves

The metadata limits described below are known design trade-offs, not
vulnerabilities, but we're glad to hear ideas for reducing them.

## Good faith

We won't pursue or support legal action against anyone who researches and
reports in good faith under this policy: you avoid privacy violations, data
destruction and service disruption, only access data that belongs to you,
stop and report as soon as you find a way to reach someone else's data, and
give us reasonable time to fix the issue before telling others. If you're
unsure whether something is allowed, ask us first.

## Security model in short

- **Content is encrypted on the client.** The CLI and the web app encrypt
  pouch content, file names and pouch names before upload
  (XChaCha20-Poly1305 sealed objects, see
  [`packages/crypto/src/sealed.ts`](packages/crypto/src/sealed.ts) and
  [`blobs.ts`](packages/crypto/src/blobs.ts)). The server stores and relays
  ciphertext and never holds content keys.
- **Who belongs to an account is a signed hash chain.** The roster
  ([`roster.ts`](packages/crypto/src/roster.ts)) is append-only and signed by
  members; clients replay and verify it themselves, so the server can't add a
  device or swap keys unnoticed. Pouch keys reach each member in HPKE
  envelopes ([`key-envelopes.ts`](packages/crypto/src/key-envelopes.ts)).
- **Unlock secrets stay with the user.** Master password, Recovery Key and
  passkeys derive member keys on the client
  ([`secrets.ts`](packages/crypto/src/secrets.ts)). The per-account pepper
  mixed into the password derivation is stored only sealed with a server key
  that is kept out of the database and its backups
  ([`apps/api/src/security/pepper.ts`](apps/api/src/security/pepper.ts)).
- **Requests are bound to keys.** Devices and browser sessions prove
  possession of their key with DPoP; the API checks structure and signatures
  of everything it stores ([`apps/api/src/security`](apps/api/src/security)),
  and tenant data is only reachable through row-level security
  ([`apps/api/README.md`](apps/api/README.md)).

What the service can see: account and device identifiers, email addresses
from sign-in, sizes and timing of uploads, the number of pouches and files,
plan and billing state, IP addresses and user agents of requests, and the
token-usage counts the CLI reports. The web app is served by the same service, so it has to be
trusted when it's loaded; the CLI does not depend on code delivered by the
server. Operational details of a deployment are in
[`deploy/README.md`](deploy/README.md).

[cli]: https://github.com/skillpouch/skillpouch-cli
