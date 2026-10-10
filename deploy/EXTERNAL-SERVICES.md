# External services

Every URL to paste into a third-party dashboard, and where its credentials go
on the server. The app and its API are `app.skillpouch.net` (this server);
the landing page `skillpouch.net` is a static site on Cloudflare Pages.
Replace the domains if you host under others.

Credentials: IDs go in `deploy/env/api.env`; secrets go in
`deploy/secrets/<name>` (one value per file), followed by
`sudo chown 10001:docker deploy/secrets/* && sudo chmod 600 deploy/secrets/*`.
Apply changes with `deploy/tunnel/update.sh --force` (or the plain
`scripts/deploy.sh` on a VPS).

## Sign-in

| Service      | Where                                                               | Setting                                                                                                                                | Credentials                                         |
| ------------ | ------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| GitHub OAuth | org skillpouch → Settings → Developer settings → OAuth Apps → New   | Homepage `https://skillpouch.net` · Callback `https://app.skillpouch.net/v1/auth/callback/github`                                      | `GITHUB_CLIENT_ID` · `secrets/github_client_secret` |
| Google OAuth | console.cloud.google.com → Google Auth Platform → Clients → Web app | JS origin `https://app.skillpouch.net` · Redirect `https://app.skillpouch.net/v1/auth/callback/google` · Scopes `openid email profile` | `GOOGLE_CLIENT_ID` · `secrets/google_client_secret` |

## Marketplaces (private GitHub repositories)

Optional. Without it, marketplaces still work for public repositories,
skills.sh and the MCP Registry.

Create it under org skillpouch → Settings → Developer settings → GitHub Apps → New:

| Setting                                                | Value                                                                                                        |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| Homepage URL                                           | `https://skillpouch.net`                                                                                     |
| Callback URL                                           | `https://app.skillpouch.net/github/connected` (add `http://localhost:5173/github/connected` for development) |
| Request user authorization (OAuth) during installation | on                                                                                                           |
| Webhook                                                | off                                                                                                          |
| Repository permissions                                 | Contents: read-only, Metadata: read-only                                                                     |
| Organization permissions                               | Members: read-only (lets org admins connect their org)                                                       |
| Where can this app be installed                        | Any account                                                                                                  |

Then generate a client secret and a private key (`.pem`). Credentials:
`GITHUB_APP_ID`, `GITHUB_APP_SLUG` (the app's URL name), `GITHUB_APP_CLIENT_ID`
in `api.env`; `secrets/github_app_client_secret` and
`secrets/github_app_private_key` (the whole `.pem` file).

Optional `secrets/github_public_token`: a fine-grained token with no
permissions. Public repository reads then get 5000 instead of 60 requests per
hour.

## Billing (Polar)

| Where                                 | Setting                                                                                                                                                                                                                                                           | Credentials                    |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ |
| Settings → Developers → Access tokens | Organization access token                                                                                                                                                                                                                                         | `secrets/polar_access_token`   |
| Settings → Webhooks → Add endpoint    | URL `https://app.skillpouch.net/v1/billing/webhooks/polar` · format **Raw** · events `subscription.created`, `.updated`, `.active`, `.canceled`, `.uncanceled`, `.revoked`, `product.created`, `product.updated`, `order.paid`, `order.updated`, `order.refunded` | `secrets/polar_webhook_secret` |
| —                                     | `POLAR_SERVER=sandbox` while testing, `production` for real payments (sandbox and production have separate tokens and webhooks)                                                                                                                                   | `api.env`                      |

Checkout returns to `WEB_ORIGIN/app/account/billing?ok=1` (sent with each
checkout, nothing to set in Polar). Products, their metadata and how they're
linked to plans:
[POLAR-PRODUCTS.md](POLAR-PRODUCTS.md).

Local development uses the same webhook path on your tunnel URL
(`<tunnel>/v1/billing/webhooks/polar`, see `apps/api/.env.example`).

## Infrastructure

| Service               | Setting                                                                                       |
| --------------------- | --------------------------------------------------------------------------------------------- |
| Cloudflare Tunnel     | Public hostname `app.skillpouch.net` → HTTP → `localhost:80`                                  |
| Cloudflare Pages      | Project `skillpouch-site`, custom domain `skillpouch.net` (see below)                         |
| GitHub Actions runner | repo → Settings → Actions → Runners → New; label `skillpouch-server` (see `tunnel/README.md`) |

## Landing on Cloudflare Pages

The landing page, Terms and Privacy (`apps/site`) are static files on
Cloudflare Pages; CI deploys `apps/site/dist` on every push to `main` once
the checks pass.

1. Cloudflare → Workers & Pages → Create → Pages → **Direct Upload**, project
   name `skillpouch-site` (upload anything once; CI replaces it).
2. The project → Custom domains → add `skillpouch.net` (and `www.skillpouch.net`
   with a redirect rule to the apex, if wanted).
3. My Profile → API Tokens → Create token with **Account · Cloudflare Pages ·
   Edit**. In GitHub → repo → Settings → Secrets and variables → Actions, add
   `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` (Workers & Pages →
   Account details). Without them the deploy job is skipped.

The site links to the app at `https://app.skillpouch.net`; set `PUBLIC_APP_URL`
at build time for another host.

## File storage (Cloudflare R2, optional)

Only needed with `BLOB_DRIVER=s3`; the default keeps files on the server's
disk. Files are encrypted before they reach the API, so the bucket only ever
holds ciphertext.

| Where                                             | Setting                                                                         | Credentials                                                                     |
| ------------------------------------------------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Cloudflare → R2 → Create bucket                   | Name `skillpouch-blobs`, location automatic, no public access                   | `S3_BUCKET`                                                                     |
| R2 → Overview → Account details                   | S3 API URL `https://<account id>.r2.cloudflarestorage.com` (without the bucket) | `S3_ENDPOINT`                                                                   |
| R2 → Manage API tokens → Create Account API token | Permission **Object Read & Write**, only bucket `skillpouch-blobs`              | `S3_ACCESS_KEY_ID` · `S3_SECRET_ACCESS_KEY` (or `secrets/s3_secret_access_key`) |

## Admin access

`ADMIN_EMAILS` in `api.env`: comma-separated emails that get the admin
dashboard after signing in.
