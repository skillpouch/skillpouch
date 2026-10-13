# AGENTS.md

Instructions for coding agents working in this repository. Read this first;
it overrides general habits. The CLI lives in a separate repository,
[`skillpouch-cli`](https://github.com/skillpouch/skillpouch-cli).

## What this is

SkillPouch syncs a user's AI coding setup (skills, agents, instructions, MCP
servers, hooks, plugins, marketplaces) across computers and assistants,
**end-to-end encrypted**: content is encrypted on the user's device and the
server only stores and relays ciphertext.

| Path                 | What                                                                                   | Served at                        |
| -------------------- | -------------------------------------------------------------------------------------- | -------------------------------- |
| `apps/api`           | Fastify API + background worker (`src/modules/<name>/<name>.routes.ts`/`.service.ts`)  | `app.skillpouch.net/v1`          |
| `apps/web`           | React + Vite dashboard (`src/features`, `src/pages`, `src/components`)                 | `app.skillpouch.net`             |
| `apps/site`          | Astro landing page, Terms, Privacy                                                     | `skillpouch.net` (CF Pages)      |
| `apps/docs`          | Astro Starlight documentation                                                          | `docs.skillpouch.net` (CF Pages) |
| `packages/contracts` | Zod schemas, error codes, generated OpenAPI — the API ↔ client contract                |                                  |
| `packages/crypto`    | Client-side E2EE formats, keys, roster verification (shared test vectors with Rust)    |                                  |
| `packages/db`        | Drizzle schema + plain SQL migrations (`migrations/NNNN_name.sql`)                     |                                  |
| `deploy/`            | Self-hosting: Docker Compose, Caddy, Cloudflare Tunnel, deploy/backup/failover scripts |                                  |

`.engram/GRAPH_REPORT.md` is a code map of the repo; see
[Code map](https://docs.skillpouch.net/development/code-map/).

## Working rules

- **Commit locally; never push** unless the owner says "push". Ask before any
  outward-facing action (pushing, releases, changing GitHub/Cloudflare settings).
- **Work goes through pull requests, never straight to `main`.** Start each
  feature or fix on its own branch (`feat/…`, `fix/…`, `docs/…`); "push" means
  push that branch and open a PR with `gh pr create`. Pull requests only run
  checks; the server and Cloudflare deploy only from `main` after merge.
- **Commit messages:** `<area>: <what changed, in plain words>` in lowercase,
  e.g. `site: favicons and a web manifest`, `api: passkey unlockers need step-up
to add`. Areas: `api`, `web`, `site`, `docs`, `db`, `crypto`, `contracts`,
  `deploy`, `ci`, `test`. Small, logical commits.
- **The production machine is "the server".** Never write "Pi" or "Raspberry"
  in code, comments, docs or commit messages.
- **Only true claims** in user-facing copy (landing, docs, READMEs): no
  invented stats, users, testimonials or features. Verify against the code.
- **Every behavior change gets a test.** Bug fixes get a regression test.
- **Every user-visible change updates `apps/docs` in the same commit.** New or
  changed features, web app screens, settings, assistants, limits, env vars
  and error hints (`apps/docs/scripts/gen-errors.mjs`). Error codes and the API
  reference are generated, but a new code that users can hit needs a hint. If
  nothing in the docs changes, say why in the commit body. A task isn't done
  until its docs are.
- **All documentation lives in `apps/docs`.** No other Markdown files in the
  repo besides `README.md`, `AGENTS.md` and `SECURITY.md` (and generated
  output like `.engram/`). Self-hosting, operations, services setup,
  architecture and maintainer notes are docs pages; link to them from code
  comments and scripts as `docs.skillpouch.net/<path>`.
- **Comments:** match the surrounding density; explain non-obvious _why_.
  Never reference the planning documents (`plan/…`, "§12") in code.
- New source files start with `// SPDX-License-Identifier: AGPL-3.0-only`
  (or the equivalent comment syntax).
- Leave untracked files you didn't create alone and never stage them. Stage
  files by name, not `git add -A`.
- Don't stop or restart the owner's dev servers unless asked.

## Commands

```sh
pnpm install
pnpm dev:db            # Postgres for development (Docker)
pnpm db:migrate
pnpm dev               # API :8080, web :5173, site :4321
pnpm --filter @skillpouch/docs dev   # docs :4322
```

Gates — all must pass before you commit (CI runs the same):

```sh
pnpm format:check      # Prettier: tabs, width 4, single quotes, printWidth 100
pnpm lint
pnpm typecheck         # includes `astro check` for site and docs
pnpm test              # API integration tests need TEST_DATABASE_URL, see below
pnpm contracts:generate && git diff --exit-code -- packages/contracts/generated
pnpm openapi --check
```

- API tests run against a real Postgres:
  `TEST_DATABASE_URL=postgres://postgres:postgres@localhost:55432/postgres`
  (container `skillpouch-pg-test`). Run one file with
  `pnpm --filter @skillpouch/api exec vitest run <path>`.
- Playwright e2e (`pnpm --filter @skillpouch/web e2e`) is **not** in CI and
  takes several minutes. Run it only when asked or before a big release.

## Security (non-negotiable)

- **E2EE:** the server never receives plaintext pouch content, keys, master
  passwords, PRF outputs or anything derived from them. Never add a route or
  log line that would carry them.
- **Tenant isolation:** tenant data is read and written inside
  `withTenantTx(deps.db.app, principal.storageAccountId, …)`; get the caller
  with `principalOf` / `sessionOf`. Never query tenant tables outside it.
- **Every new tenant table gets row-level security** in its migration, like
  the existing ones (a missing policy has broken CI before).
- Sensitive actions require step-up (`config: { stepUp: true }`) and append
  an audit entry (`appendAudit`); security-relevant changes also raise a
  security event.
- Errors go through `AppError` with a code registered in `packages/contracts`
  (then regenerate contracts).
- Clients must refuse a lying server: signatures, roster order, blob ids and
  AEAD are verified client-side. Don't weaken a verification to make a test pass.

## Database and contracts

- Migrations are append-only plain SQL: add the next `NNNN_name.sql`, never
  edit a released one. Update the Drizzle schema in `packages/db/src/schema`.
- API request/response shapes live in `packages/contracts`; change them there,
  then `pnpm contracts:generate` and `pnpm openapi`. Additive changes only
  within `/v1`.

## Frontend

- Web and site share the brand: pitch black, purple `#8442D9`, text `#ededed`,
  Geist Sans/Mono (self-hosted). Loading states are page-shaped skeletons.
- Site islands (`client:load` / `client:visible`) are React; keep heavy code
  (three.js) out of pages that don't need it.
- If the Astro dev server shows "Outdated Optimize Dep" or islands stop
  hydrating, clear `node_modules/.vite` and `.astro` in that app and restart
  it. New files in `public/` also need a restart.

## Deploys

- Every workflow runs only for its own paths (allow lists, not ignore
  lists). `app-ci.yml` checks the API, web app and packages on pull requests
  only; main isn't re-checked after a merge. `deploy.yml` ("app deploy")
  deploys app + API to the server (self-hosted runner) on pushes to main that
  change them. `site.yml` and `docs.yml` check and deploy the site and docs
  to Cloudflare Pages. A new app folder must be added to the `paths` lists of
  `app-ci.yml` and `deploy.yml`.
- The self-hosted runner is restricted to `deploy.yml` on `main`. Never add
  workflows that run on it.
- Server-side settings live in `deploy/env/*.env` and `deploy/secrets/` on the
  server, never in the repo or GitHub secrets.

<!-- BEGIN:turborepo-agent-rules -->

# This is NOT the Turborepo you know

Turborepo configuration, task behavior, and CLI commands can vary between installed versions and may differ from your training data. Resolve the `turbo` package from this file's directory or relevant workspace; in monorepos, it may not be visible from the repository root. For example, run `node -p "require.resolve('turbo/package.json')"` from a workspace that depends on `turbo`.

Read `docs/README.md` inside that installed package first, then read the relevant pages from its `docs/` directory before changing Turborepo configuration or commands. Heed deprecation notices. These bundled docs match the installed package version and are available without network access.

This block is written and re-added by `turbo` before repository-scoped commands when an AI agent is detected. In the Turborepo source repository, its template is defined in `crates/turborepo-cli/src/cli/agent_guidance.rs`. Removing the managed block while updates are enabled means a later qualifying invocation will add it again. Set `"agentGuidance": false` in the root `turbo.json` or `turbo.jsonc` to opt out; this does not remove an existing block. Keep the block committed with your work to avoid an uncommitted change on the next agent invocation.
<!-- END:turborepo-agent-rules -->
