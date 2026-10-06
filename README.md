# SkillPouch

Sync your AI-harness setup — skills, plugins, MCP servers, hooks, agent and
instruction files — across every machine, end-to-end encrypted.

This monorepo holds the **server side**: the HTTP API + background worker,
the shared wire contracts and the database schema. The CLI (Rust) lives in
its own repository and talks to this API only through
`@skillpouch/contracts`. The design is specified in the plan documents
(`../plan/00-overview.md` … `18-admin-plans-roles.md`); code comments cite them
as `plan NN §x`.

| Path                 | What                                                                                   |
| -------------------- | -------------------------------------------------------------------------------------- |
| `apps/api`           | Fastify 5 API + pg-boss worker (one image, `API_ROLE=api\|worker\|migrate`)            |
| `packages/contracts` | Zod schemas, error-code registry, limits, canonical JSON — the wire contract           |
| `packages/db`        | SQL migrations (RLS, roles), Drizzle schema, migration runner, test DB templates       |
| `packages/config`    | Shared TypeScript config                                                               |
| `deploy/`            | Dockerfile, Compose (blue/green), Caddy, Postgres init, deploy/rollback/backup scripts |
| `docs/errors.md`     | Generated catalogue of every API error code                                            |
| `.engram/`           | Code knowledge graph for maintainers (`docs/maintainers/engram.md`)                    |

## Quick start (development)

Requirements: Node 24, pnpm 10, Docker.

```sh
pnpm install
pnpm dev:db                                   # Postgres on localhost:5432
export DATABASE_URL=postgres://postgres:postgres@localhost:5432/skillpouch
pnpm db:migrate
pnpm dev:api                                  # http://localhost:8080
```

Swagger UI is served at **http://localhost:8080/docs** (OpenAPI JSON at
`/docs/json`) whenever `NODE_ENV` is not `production` (or `SWAGGER=true`).
The same spec is committed at `packages/contracts/generated/openapi.json` for
client generation; run `pnpm openapi` after changing a route (CI checks it).
OAuth sign-in needs `GITHUB_CLIENT_ID/SECRET` and/or `GOOGLE_CLIENT_ID/SECRET`;
every variable is documented in `apps/api/src/config/env.ts`.

## Tests

The suite needs a disposable Postgres superuser at `TEST_DATABASE_URL`
(default `postgres://postgres:postgres@localhost:55432/postgres`):

```sh
docker run -d --name skillpouch-pg-test -p 55432:5432 -e POSTGRES_PASSWORD=postgres postgres:16-alpine
pnpm test                                          # everything
pnpm --filter @skillpouch/api exec vitest run --project e2e   # end-to-end only
```

Each test file gets its own database cloned from a migrated template, and
tests drive the real server (`buildServer`) with clients that behave like the
web app and the CLI on the wire (DPoP proofs, signed statements, sealed
ciphertext). The e2e project runs the same server on a real socket.

| Layer       | Where                            | Covers                                                            |
| ----------- | -------------------------------- | ----------------------------------------------------------------- |
| unit        | `*/test/unit`, `packages/*/test` | pure functions: canonical JSON, entitlement resolution, detection |
| integration | `apps/api/test/integration`      | every route group, RLS/tenant isolation, jobs, billing, admin     |
| e2e         | `apps/api/test/e2e`              | full journey over HTTP: SSE, long-poll, unlock, revoke, shutdown  |
| catalog     | `packages/db/test`               | RLS enabled+forced on every tenant table, composite FKs, grants   |

CI (`.github/workflows/ci.yml`) runs format/lint/typecheck, the contracts
drift check, the full suite against Postgres 16, a production-bundle boot
smoke test and the API image build.

## Production

`deploy/README.md` describes the single-host stack (Caddy → blue/green API,
worker, Postgres, blobs on a mounted volume), zero-downtime deploys,
automatic expand-only migrations, backups and moving to a new host.

## License

AGPL-3.0-only. Contributions are accepted under the DCO (`Signed-off-by`).
