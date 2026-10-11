---
title: Deploys and day-to-day
description: Zero-downtime deploys, rollbacks, database migrations and everyday commands for a SkillPouch server.
---

## Everyday commands

|                               | How                                                                                                         |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Deploy                        | Push or merge to `main`; it's deployed right after CI passes                                                |
| Watch a deploy                | GitHub → Actions → deploy                                                                                   |
| Deploy now, or a given commit | Actions → deploy → Run workflow → `deploy` (optionally with a commit), or `deploy/tunnel/update.sh --force` |
| Roll back the API             | Actions → deploy → Run workflow → `rollback`, or `deploy/scripts/rollback.sh`                               |
| Stop automatic deploys        | Actions → deploy → ⋯ → Disable workflow                                                                     |
| Logs                          | `cd deploy && docker compose --env-file env/stack.env logs -f api-blue api-green worker`                    |
| Back up                       | `deploy/scripts/backup.sh` ([Backups](/self-hosting/backups/))                                              |

Pushes that only change the landing page, these docs, workflows or Markdown
files don't redeploy the server.

## What a deploy does

`scripts/deploy.sh <image>` (behind a tunnel, `update.sh` calls it for you):

1. pulls the image
2. runs the database migrations; if they fail the deploy stops and the
   live API is untouched
3. starts the idle color and waits for `/readyz`
4. checks the new color's error rate
5. switches Caddy to it with a graceful reload
6. drains the old color: streaming clients are told to reconnect, waiting
   requests wake up, and there are 25 seconds of grace
7. restarts the worker
8. runs a smoke test against `/readyz` on your hostname (`PUBLIC_HOST`)

Any failure rolls back automatically. `scripts/rollback.sh` switches back
to the previous color in seconds.

## Database migrations

Migrations are plain SQL files with a `-- phase: expand` or
`-- phase: contract` header. They are applied under an advisory lock, with
a lock timeout and retries. A deploy only runs **expand** migrations, which
the old version still works with; destructive changes ship later as a
separate **contract** migration.

## Landing page and docs

`skillpouch.net` and `docs.skillpouch.net` are static sites on Cloudflare
Pages, deployed by their own workflows (`site.yml`, `docs.yml`) on pushes to
`main` that change them. A self-hosted server doesn't need them. To deploy
your own copies:

1. Cloudflare → **Workers & Pages → Create → Pages → Direct Upload**,
   project `skillpouch-site` (or `skillpouch-docs`). Upload anything once;
   the workflow replaces it.
2. In the project, **Custom domains** → add your domain.
3. **My Profile → API Tokens → Create token** with **Account · Cloudflare
   Pages · Edit**. In the GitHub repository's **Settings → Secrets and
   variables → Actions**, add `CLOUDFLARE_API_TOKEN` and
   `CLOUDFLARE_ACCOUNT_ID` (from **Workers & Pages → Account details**).
   Without them the deploy step is skipped.

The site links to the app at `https://app.skillpouch.net`; set
`PUBLIC_APP_URL` at build time for another host.
