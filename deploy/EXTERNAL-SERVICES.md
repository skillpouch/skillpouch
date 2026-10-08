# External services

Every URL to paste into a third-party dashboard, and where its credentials go
on the server. Replace `skillpouch.net` if you host under another domain.

Credentials: IDs go in `deploy/env/api.env`; secrets go in
`deploy/secrets/<name>` (one value per file), followed by
`sudo chown 10001:docker deploy/secrets/* && sudo chmod 600 deploy/secrets/*`.
Apply changes with `deploy/tunnel/update.sh --force` (or the plain
`scripts/deploy.sh` on a VPS).

## Sign-in

| Service      | Where                                                               | Setting                                                                                                                        | Credentials                                         |
| ------------ | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------- |
| GitHub OAuth | org skillpouch → Settings → Developer settings → OAuth Apps → New   | Homepage `https://skillpouch.net` · Callback `https://skillpouch.net/v1/auth/callback/github`                                  | `GITHUB_CLIENT_ID` · `secrets/github_client_secret` |
| Google OAuth | console.cloud.google.com → Google Auth Platform → Clients → Web app | JS origin `https://skillpouch.net` · Redirect `https://skillpouch.net/v1/auth/callback/google` · Scopes `openid email profile` | `GOOGLE_CLIENT_ID` · `secrets/google_client_secret` |

## Billing (Polar)

| Where                                 | Setting                                                                                                                                                                | Credentials                    |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ |
| Settings → Developers → Access tokens | Organization access token                                                                                                                                              | `secrets/polar_access_token`   |
| Settings → Webhooks → Add endpoint    | URL `https://skillpouch.net/v1/billing/webhooks/polar` · format **Raw** · events `subscription.created`, `.updated`, `.active`, `.canceled`, `.uncanceled`, `.revoked` | `secrets/polar_webhook_secret` |
| —                                     | `POLAR_SERVER=sandbox` while testing, `production` for real payments (sandbox and production have separate tokens and webhooks)                                        | `api.env`                      |

After the first start, open the admin dashboard and save the Supporter plan
once: that creates the Polar product.

Local development uses the same webhook path on your tunnel URL
(`<tunnel>/v1/billing/webhooks/polar`, see `apps/api/.env.example`).

## Infrastructure

| Service                  | Setting                                                                                       |
| ------------------------ | --------------------------------------------------------------------------------------------- |
| Cloudflare Tunnel        | Public hostname `skillpouch.net` → HTTP → `localhost:80`                                      |
| Cloudflare Email Routing | `info@skillpouch.net` → personal inbox                                                        |
| GitHub Actions runner    | repo → Settings → Actions → Runners → New; label `skillpouch-server` (see `tunnel/README.md`) |

## Admin access

`ADMIN_EMAILS` in `api.env`: comma-separated emails that get the admin
dashboard after signing in.
