# @skillpouch/api

The SkillPouch HTTP API and background worker (plan `06`). The server never
sees plaintext: names, paths and file contents arrive encrypted and signed by
roster members (plan `15`); the API checks structure, signatures, tenancy and
quotas, stores ciphertext and fans out events.

## Layout

```
src/
├── main.ts              entrypoint: API_ROLE=api | worker | migrate, graceful shutdown
├── worker.ts            pg-boss scheduler + job runner
├── server.ts            buildServer(deps) — the exact wiring used by tests and production
├── deps.ts              the dependency container (no DI framework, no singletons)
├── config/env.ts        Zod-validated environment (secrets via *_FILE)
├── http/                envelope + serializer, AppError, principals, cursors, Swagger
├── security/            authentication hook, DPoP, access tokens, tenant transactions,
│                        audit hash chain, E2EE structural checks, pepper sealing, rate limits
├── infra/               DB pools (per role), LISTEN hub, NOTIFY, blob store, metrics, logger
├── jobs/                retention, GC, purges, housekeeping, registry of schedules
└── modules/<feature>/   <feature>.routes.ts (HTTP + schema) · <feature>.service.ts (logic)
    account  admin  artifacts  auth  billing  blobs  cli-auth  conflicts  devices
    entitlements  events  health  import  operations  pouches  roster  session
    snapshots  unlock
```

Rules every module follows:

- **Every route declares `config.auth`** (`public | session | device | any |
admin`); the server refuses to boot otherwise. Optional `stepUp`,
  `rateLimit`, `raw`.
- **Tenant data is only reachable through `withTenantTx`**, which sets
  `app.sa_id` for Postgres RLS; the tenant always comes from the
  credential, never from the request. Foreign IDs answer `404`.
- **Errors are `AppError(code, details)`** with a code from
  `@skillpouch/contracts` (lint-enforced); responses use the `{ ok, data,
meta }` envelope (plan `17`).
- Handlers return plain data; the response schema documents it in Swagger.

## Running

See the repository README for the dev database. Then:

```sh
pnpm dev                 # tsx watch src/main.ts → http://localhost:8080, Swagger at /docs
pnpm build               # dist/main.mjs (workspace packages bundled)
API_ROLE=worker pnpm start
API_ROLE=migrate pnpm start
```

Metrics are served on `METRICS_PORT` (default 9464) at `/metrics`, never
through the public proxy.

## Main flows (where to read)

| Flow                                                                             | Entry point                                   |
| -------------------------------------------------------------------------------- | --------------------------------------------- |
| Browser session binding (DPoP)                                                   | `modules/session`, `security/authenticate.ts` |
| Account genesis, roster, key envelopes                                           | `modules/roster`                              |
| Unlock: master password + pepper, passkeys (PRF), Recovery Key, trusted browsers | `modules/unlock`                              |
| "Authorize CLI" login, refresh rotation, revoke                                  | `modules/cli-auth`, `modules/devices`         |
| Commit (optimistic concurrency, conflicts, idempotency)                          | `modules/operations/operations.service.ts`    |
| Event log, long-poll, account-wide SSE                                           | `modules/events`                              |
| Encrypted blobs, quota reservation                                               | `modules/blobs`                               |
| Plans, grants, overrides → entitlements                                          | `modules/entitlements`, `modules/admin`       |
| Polar checkout / webhooks / reconcile                                            | `modules/billing`                             |
| Background jobs                                                                  | `jobs/registry.ts`                            |

## Tests

`test/helpers` contains clients that speak the protocol exactly like the web
app (`BrowserClient`) and the CLI (`CliClient`), multi-step flows
(`setupAccount`, `authorizeCli`), E2EE stand-ins (real signatures, sealed
headers), a sync helper and a software WebAuthn authenticator.
