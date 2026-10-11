---
title: Sign-in and GitHub
description: Set up GitHub and Google sign-in, and the optional GitHub App for private-repository marketplaces.
---

People sign in to SkillPouch with GitHub or Google. Set up at least one.
Replace `app.skillpouch.net` with your hostname everywhere below.

IDs go in `deploy/env/api.env`, secrets in `deploy/secrets/`
([Configuration](/self-hosting/configuration/#secrets)).

## GitHub sign-in

GitHub → your organization or account → **Settings → Developer settings →
OAuth Apps → New OAuth App**:

| Setting      | Value                                                |
| ------------ | ---------------------------------------------------- |
| Homepage URL | your site, e.g. `https://app.skillpouch.net`         |
| Callback URL | `https://app.skillpouch.net/v1/auth/callback/github` |

Credentials: `GITHUB_CLIENT_ID` in `api.env`, the client secret in
`secrets/github_client_secret`.

## Google sign-in

[Google Cloud console](https://console.cloud.google.com) → **Google Auth
Platform → Clients → Create client → Web application**:

| Setting                 | Value                                                |
| ----------------------- | ---------------------------------------------------- |
| Authorized JS origin    | `https://app.skillpouch.net`                         |
| Authorized redirect URI | `https://app.skillpouch.net/v1/auth/callback/google` |
| Scopes                  | `openid`, `email`, `profile`                         |

Credentials: `GOOGLE_CLIENT_ID` in `api.env`, the client secret in
`secrets/google_client_secret`.

## GitHub App for private marketplaces

Optional. Without it, marketplaces still work for public repositories,
skills.sh and the MCP Registry. With it, people can connect their GitHub
account or organization and add marketplaces from private repositories.

GitHub → **Settings → Developer settings → GitHub Apps → New GitHub App**:

| Setting                                                | Value                                                                                                        |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| Homepage URL                                           | your site                                                                                                    |
| Callback URL                                           | `https://app.skillpouch.net/github/connected` (add `http://localhost:5173/github/connected` for development) |
| Request user authorization (OAuth) during installation | on                                                                                                           |
| Webhook                                                | off                                                                                                          |
| Repository permissions                                 | Contents: read-only, Metadata: read-only                                                                     |
| Organization permissions                               | Members: read-only (lets organization admins connect their organization)                                     |
| Where can this app be installed                        | Any account                                                                                                  |

Then generate a client secret and a private key (`.pem`). Credentials:

- in `api.env`: `GITHUB_APP_ID`, `GITHUB_APP_SLUG` (the app's name in its
  URL) and `GITHUB_APP_CLIENT_ID`
- in `secrets/`: `github_app_client_secret` and `github_app_private_key`
  (the whole `.pem` file)

Set all five or none; the API refuses to start with only some of them.

### More GitHub requests

Optional: put a fine-grained GitHub token **with no permissions** in
`secrets/github_public_token`. Reads of public repositories then get 5000
instead of 60 requests per hour.

## Admin access

`ADMIN_EMAILS` in `api.env` is a comma-separated list of emails. Those
accounts get the admin dashboard after signing in.
