---
title: Self-hosting overview
description: What a SkillPouch server runs, what it needs, and which install path to pick.
---

SkillPouch is open source (AGPL-3.0), and the same stack that runs
`app.skillpouch.net` can run on your own machine. The server only ever
stores and relays ciphertext: pouch content is encrypted on each computer
before it is uploaded.

## What runs where

One host runs the web app and its API with Docker Compose:

```
Caddy (TLS, web app, /v1 → live color) ─┬─ api-blue  ┐  same image,
                                         └─ api-green ┘  API_ROLE=api
worker (API_ROLE=worker) · Postgres 16 · files on /srv/skillpouch/blobs
```

- **Caddy** serves the web app and sends `/v1` to whichever API container
  is live. Two API "colors" let a deploy start the new version next to the
  old one and switch without downtime.
- **The worker** runs background jobs: retention, cleanup, billing
  reconciliation.
- **Postgres** holds accounts, pouches and ciphertext metadata, with
  row-level security per account.
- **Files** (encrypted blobs) live on a data volume, or in an S3-compatible
  bucket such as Cloudflare R2 ([File storage](/self-hosting/file-storage/)).

The landing page and these docs are static sites on Cloudflare Pages; a
self-hosted server doesn't need them.

## Pick an install path

| Path                                              | For                                                                                                                       |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| [Behind Cloudflare Tunnel](/self-hosting/tunnel/) | Any Linux machine, including one at home. No open ports, HTTPS by Cloudflare, and every push to `main` deploys by itself. |
| [On a VPS with a public IP](/self-hosting/vps/)   | A server that Caddy serves directly, with its own TLS certificate.                                                        |

Both use the same Compose stack, scripts and configuration.

## Requirements

- Debian or Ubuntu, **64-bit** (amd64 or arm64)
- 4 GB of RAM or more
- an SSD for the data volume (Postgres wears out SD cards)
- a domain you control, and sign-in apps at GitHub and/or Google
  ([Sign-in and GitHub](/self-hosting/sign-in/))

## How big a server

These sizes come from load tests with the production image, real
signatures on every request and rate limits on. Details are in
[Performance](/development/performance/).

| Connected computers | API                 | Postgres      |
| ------------------- | ------------------- | ------------- |
| up to 10 000        | 1 × 2 vCPU / 2 GB   | 2 vCPU / 4 GB |
| up to 50 000        | 2–3 × 2 vCPU / 4 GB | 4 vCPU / 8 GB |
| up to 100 000       | 4 × 2 vCPU / 4 GB   | 4 vCPU / 8 GB |

A personal or team server is far below the first row.

## Before you open it to others

- Back up `pepper_key` and `jwt_signing_key` offline the moment they are
  created ([Configuration](/self-hosting/configuration/#secrets)). They are
  not in backups, and losing `pepper_key` locks everyone out of
  master-password unlock.
- Set up [backups](/self-hosting/backups/) and test a restore.
- Run a recent commit of `main`: fixes are not backported.
