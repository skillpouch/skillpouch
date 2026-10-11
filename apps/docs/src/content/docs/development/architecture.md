---
title: Architecture
description: How the SkillPouch repository is laid out, how the API is built, and where each flow lives.
---

## Repository layout

| Path                 | What                                                                        | Served at               |
| -------------------- | --------------------------------------------------------------------------- | ----------------------- |
| `apps/api`           | Fastify API and background worker                                           | `app.skillpouch.net/v1` |
| `apps/web`           | React dashboard: pouches, devices, account, conflicts                       | `app.skillpouch.net`    |
| `apps/site`          | Astro landing page, Terms and Privacy                                       | `skillpouch.net`        |
| `apps/docs`          | These docs (Astro Starlight)                                                | `docs.skillpouch.net`   |
| `packages/contracts` | Zod schemas, error codes and the generated OpenAPI spec                     |                         |
| `packages/crypto`    | Client-side encryption formats, keys and roster verification                |                         |
| `packages/db`        | PostgreSQL schema, SQL migrations and row-level security                    |                         |
| `deploy/`            | Docker Compose stack, Caddy, Cloudflare Tunnel and operations scripts       |                         |
| `tools/`             | Load tests and query-plan checks ([Performance](/development/performance/)) |                         |

## The API

The server never sees plaintext: names, paths and file contents arrive
encrypted and signed by members of the account. The API checks structure,
signatures, tenancy and quotas, stores ciphertext and tells other devices
about changes.

```
apps/api/src/
├── main.ts              entry point: API_ROLE=api | worker | migrate, graceful shutdown
├── worker.ts            job scheduler and runner
├── server.ts            buildServer(deps): the same wiring in tests and production
├── deps.ts              the dependency container (no DI framework, no singletons)
├── config/env.ts        validated environment
├── http/                response envelope, AppError, principals, cursors, OpenAPI
├── security/            authentication, DPoP, access tokens, tenant transactions,
│                        audit chain, encryption checks, pepper sealing, rate limits
├── infra/               database pools, LISTEN/NOTIFY, blob store, metrics, logger
├── jobs/                retention, cleanup, purges, schedules
└── modules/<feature>/   <feature>.routes.ts (HTTP + schema) · <feature>.service.ts (logic)
```

Every module follows the same rules:

- **Every route declares `config.auth`** (`public`, `session`, `device`,
  `any` or `admin`); the server refuses to boot otherwise. Sensitive routes
  add `stepUp`, and routes can set `rateLimit` or `raw`.
- **Account data is only reachable through `withTenantTx`**, which sets the
  account for Postgres row-level security. The account always comes from
  the credential, never from the request; IDs from other accounts answer
  `404`.
- **Errors are `AppError(code, details)`** with a code registered in
  `@skillpouch/contracts` (lint enforces it). Responses use the
  `{ ok, data, meta }` envelope. Every code has a page under
  [Error codes](/errors/).
- Handlers return plain data; the response schema documents it in the
  [API reference](/api/).

Run it alone with `pnpm --filter @skillpouch/api dev`; the OpenAPI UI is at
`http://localhost:8080/docs`. `pnpm --filter @skillpouch/api build` bundles
it into `dist/main.mjs`, which runs as API, worker or migrator depending on
`API_ROLE`. Metrics are served on `METRICS_PORT` (default 9464) at
`/metrics`, never through the public proxy.

### Where each flow lives

| Flow                                                                         | Start reading at                              |
| ---------------------------------------------------------------------------- | --------------------------------------------- |
| Browser session binding (DPoP)                                               | `modules/session`, `security/authenticate.ts` |
| Account genesis, roster, key envelopes                                       | `modules/roster`                              |
| Unlock: master password and pepper, passkeys, Recovery Key, trusted browsers | `modules/unlock`                              |
| CLI login, token refresh and revocation                                      | `modules/cli-auth`, `modules/devices`         |
| Commits: optimistic concurrency, conflicts, idempotency                      | `modules/operations/operations.service.ts`    |
| Event log, long-poll, account-wide streaming                                 | `modules/events`                              |
| Encrypted files and quota reservation                                        | `modules/blobs`                               |
| Plans, grants, overrides and the resulting limits                            | `modules/entitlements`, `modules/admin`       |
| Polar checkout, webhooks and reconciliation                                  | `modules/billing`                             |
| Background jobs                                                              | `jobs/registry.ts`                            |

### Tests

`apps/api/test/helpers` has clients that speak the protocol exactly like the
web app (`BrowserClient`) and the CLI (`CliClient`), multi-step flows
(`setupAccount`, `authorizeCli`), encryption stand-ins with real
signatures, a sync helper and a software WebAuthn authenticator.

## Changing the contract

- Request and response shapes live in `packages/contracts`. Change them
  there, then run `pnpm contracts:generate` and `pnpm openapi`. Changes
  within `/v1` are additive only.
- Database changes are a new numbered SQL file in `packages/db/migrations`
  plus the Drizzle schema in `packages/db/src/schema`. Never edit a
  released migration, and give every new account table row-level security.
