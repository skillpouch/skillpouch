---
title: Development setup
description: Run the SkillPouch web app, API, site and docs locally, and the checks every change has to pass.
---

SkillPouch is two repositories:

- [`skillpouch`](https://github.com/skillpouch/skillpouch): the API, web
  app, landing page, these docs and the shared packages
- [`skillpouch-cli`](https://github.com/skillpouch/skillpouch-cli): the
  command-line client, in Rust

This page covers the first. The layout is described in
[Architecture](/development/architecture/).

## Run it locally

You need Node.js 24+, pnpm 10 and Docker.

```sh
pnpm install
cp apps/api/.env.example apps/api/.env
pnpm dev:db        # Postgres in Docker
pnpm db:migrate
pnpm dev           # API, web app and landing page
```

| What    | Where                                   | Alone                                |
| ------- | --------------------------------------- | ------------------------------------ |
| Web app | [localhost:5173](http://localhost:5173) | `pnpm dev:web`                       |
| API     | [localhost:8080](http://localhost:8080) | `pnpm dev:api`                       |
| Landing | [localhost:4321](http://localhost:4321) | `pnpm dev:site`                      |
| Docs    | [localhost:4322](http://localhost:4322) | `pnpm --filter @skillpouch/docs dev` |

Use the web app's development sign-in for local work; you don't need GitHub
or Google apps.

## Checks

Every change has to pass these; CI runs the same:

```sh
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm contracts:generate && git diff --exit-code -- packages/contracts/generated
pnpm openapi --check
```

The API's integration tests need a real Postgres. Point them at one with
`TEST_DATABASE_URL`, for example
`postgres://postgres:postgres@localhost:55432/postgres`. Run a single file
with `pnpm --filter @skillpouch/api exec vitest run <path>`.

The browser end-to-end tests (`pnpm --filter @skillpouch/web e2e`, with
Playwright) take several minutes and don't run in CI.

## Contributing

Issues and pull requests are welcome.

- Keep changes focused, and add a test for every behavior change.
- Update these docs in the same pull request when something people can see
  changes.
- Contributions are accepted under the
  [Developer Certificate of Origin](https://developercertificate.org/):
  sign off your commits (`git commit -s`).
- Report security issues privately, not in an issue
  ([Security](/security/#reporting-a-vulnerability)).

The code is licensed under
[AGPL-3.0-only](https://github.com/skillpouch/skillpouch/blob/main/LICENSE).
