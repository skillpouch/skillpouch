# SkillPouch API — Pre-launch Security Review

Date: 2026-10-07
Scope: `apps/api` source and `packages/db` migrations in this repository.
Method: manual source review. No live services were started and no
proof-of-concept traffic was sent. Every finding below comes from reading the
code. Each one should be confirmed with a regression test in
`apps/api/test/integration` before it is closed.

## Summary

The core design is solid. Tenancy is enforced in Postgres (RLS `ENABLE` +
`FORCE`, no `missing_ok`). Access tokens are DPoP-bound and checked against the
database on every request. Blob keys are strictly validated, so path traversal
is not possible. The GitHub import only contacts fixed hosts, and dev login is
refused when `NODE_ENV=production`. No critical issue was found. The main risks
are in the CLI authorization flow (phishing), rate limiting and memory limits,
and how the server behaves if it is deployed with the wrong settings.

| #   | Severity      | Area       | Title                                                                                  |
| --- | ------------- | ---------- | -------------------------------------------------------------------------------------- |
| 1   | High (design) | cli-auth   | Any signed-in user can approve any open CLI request, which allows device-code phishing |
| 2   | Medium        | config     | `NODE_ENV` defaults to `development`, which turns on publicly known secrets            |
| 3   | Medium        | import     | GitHub scan cache has no size limit, and scans are expensive per request               |
| 4   | Low–Medium    | rate limit | Public endpoints have no default rate-limit bucket                                     |
| 5   | Low           | cli-auth   | Per-IP and per-account caps are count-then-insert races                                |
| 6   | Low           | shares     | A client-chosen share id gives a cross-tenant existence oracle                         |
| 7   | Low           | auth       | `touchDevice` map grows without bound                                                  |
| 8   | Info          | deploy     | Rate limiting and IP hashing depend on `TRUST_PROXY` being correct                     |

---

## 1. CLI authorization can be phished (High, design)

`approveCliAuthRequest` (`modules/cli-auth/cli-auth.service.ts:166`) accepts
any open request that is not yet bound to an account (`storageAccountId IS
NULL`). The request is created without authentication
(`POST /v1/cli-auth/requests`). A third party can start a request with keys
they control and send the victim the resulting `authorize_url`. If the victim
is signed in and unlocked and clicks **Authorize**, the browser:

- adds the third party's keys to the victim's roster,
- seals the welcome (key material) to the third party's `enc_pub`,
- creates a device whose tokens the third party then redeems with their own PKCE verifier and DPoP key.

PKCE and DPoP stop someone who merely steals a request id. They do not stop
the person who created the request. This is the same class of risk as OAuth
device-code phishing. Because SkillPouch is end-to-end encrypted, a successful
phish leads to a full vault compromise.

Recommendations:

- Make the connect-token flow (browser first) the default, and treat the unbound "open a link" flow as a fallback.
- On the authorize page, show a short code that the CLI also prints, and require the user to type or confirm it.
- Show the request's IP or geolocation and its age prominently, and warn when it differs from the browser's.
- Require a fresh step-up (`config.stepUp`) on `/approve`.
- Notify every other member of the account through a security event when a device is added. A `cli.authorized` event is already written; make sure it is shown to the user.

## 2. Unsafe defaults when `NODE_ENV` is unset (Medium)

`config/env.ts:31` defaults `NODE_ENV` to `development`. Outside production,
`resolveRaw` fills `BETTER_AUTH_SECRET`, `DPOP_NONCE_SECRET`,
`IP_HASH_SECRET` and `PEPPER_KEY` with constants that are in the public AGPL
source. It also generates a new JWT key on every boot, enables Swagger, and
allows `DEV_LOGIN=true`. `deploy/env/api.env.example` sets
`NODE_ENV=production`. If that line is lost or the variable is not passed
through, the server still boots, but with forgeable session cookies, a known
pepper key, and possibly passwordless dev login.

Recommendations:

- Have no default for `NODE_ENV`, or default it to `production`.
- Refuse to boot when any secret equals `DEV_SECRET` or `DEV_PEPPER_KEY` and `API_PUBLIC_URL` is not `localhost`.
- Log a loud warning at startup whenever dev defaults are used.

## 3. GitHub import: unbounded cache and amplification (Medium)

`GithubImporter` (`modules/import/github.service.ts:135`) caches results in a
`Map` with no limit on entries, and expired entries are never removed. One
entry can hold up to 400 files of up to 1 MiB each, base64-encoded (more than
500 MB in the worst case, about 1.33×). One authenticated request can also
trigger up to roughly 403 outbound fetches. The route uses only the `general`
bucket of 300 requests per minute.

Recommendations:

- Use an LRU cache limited by total bytes, and remove expired entries.
- Give `/v1/import/github/scan` its own small bucket, for example 10 per minute.
- Lower `MAX_TOTAL_FILES` or the total byte budget per scan.
- Stream the response or cap the response size.

## 4. Public endpoints have no default rate limit (Low–Medium)

In `authenticate.ts:285`, routes with `auth: 'public'` and no `rateLimit` have
no limit at all. Affected routes:

- `GET /v1/public/shares/:id` and `/bundle`. The bundle response can be up to `shareMaxBytes`, and every call writes to the database (view counter).
- `DELETE /v1/cli-auth/requests/:id`. Every call runs DPoP verification and writes to the jti table.

Recommendation: give every public route an IP-keyed bucket, either by default
or by setting it explicitly.

## 5. Count-then-insert races (Low)

The `MAX_OPEN_PER_IP` check (`cli-auth.service.ts:70`) and the
`connectTokensMaxOpen` check (`:378`) count rows and then insert in separate
statements. Concurrent requests can exceed the cap. The impact is small
because the `auth` bucket also applies. To fix it, take an advisory lock
(`pg_advisory_xact_lock`) keyed on the IP hash or the account inside one
transaction.

## 6. Share-id existence oracle (Low)

`createShare` inserts a share id chosen by the client with
`onConflictDoNothing()`. If that id already belongs to another tenant, the
insert does nothing and the caller gets `precondition_failed`. That reveals
that the share exists. Ids are random UUIDs, so the practical risk is low.
Generate the id on the server, or return the same error as a validation
failure.

## 7. `lastSeenWrites` grows without bound (Low)

`authenticate.ts:329` holds one entry per device id and never removes any.
Over a long uptime this slowly leaks memory. Use a bounded LRU cache, or clear
entries older than 60 seconds.

## 8. Correct `TRUST_PROXY` is essential (Info)

`deploy/compose.yaml` sets `TRUST_PROXY: 'true'`, which is correct behind the
reverse proxy. With `true`, Fastify trusts every `X-Forwarded-For` hop. If the
API port can be reached directly (not through the proxy), a client can spoof
its IP and bypass the per-IP `auth` bucket and the CLI request cap. Make sure
the API binds only to the internal network, or set `TRUST_PROXY` to the
proxy's address or hop count.

---

## Reviewed and found sound

- **RLS:** `FORCE ROW LEVEL SECURITY` is set. `current_setting('app.sa_id')` without `missing_ok` fails closed. `sp_app` has no BYPASSRLS. The audit and roster tables are append-only for the app role.
- **Share recipient isolation:** the `share_by_id` policy plus `app.sa_id = nil` exposes exactly one row. The claim takes a `FOR UPDATE` lock, which prevents a double claim.
- **DPoP:** checks `typ`/`alg`/`jwk`, rejects private keys, binds `htm`/`htu`/`ath`, uses an HMAC nonce limited to the current and previous bucket with a constant-time compare, and keeps a global jti replay table.
- **Access tokens:** EdDSA only, issuer, audience and `typ` are pinned, and the version and keys are checked against the database on every request.
- **Blob store:** UUID and hex64 key validation prevents path traversal. Writes are atomic and never overwrite.
- **CSRF:** session writes require an exact `Origin` and the `Skillpouch-Client` header. CORS allows only one origin.
- **Dev routes:** registered only when `DEV_LOGIN` is set and not in production, and the env schema refines that as well (see #2 for the remaining gap).

## Suggested regression tests

1. Integration test: a request created by account B's CLI and approved by account A. Expected after the fix: a confirmation code or step-up is required.
2. Unit test: `loadEnv({})` without `NODE_ENV` and with a non-localhost `API_PUBLIC_URL` must throw.
3. Unit test: the GitHub importer cache stays within its byte limit when many distinct repositories are scanned.
4. Integration test: public share endpoints return `429` after the bucket is used up.

---

## Status after fixes (2026-10-07)

| #   | Status   | What changed                                                                                                                                                                                                                                                                   | Regression test                                                           |
| --- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------- |
| 1   | Fixed    | Link logins (`/cli/authorize?request=…`) need the 8-digit code the terminal printed. The page never shows the code and warns against authorizing links from others; the server checks it before parsing anything. Connect-token logins (started by the browser) are unchanged. | `auth.test.ts` "phishing" + "confirm code matches"; e2e `devices.spec.ts` |
| 2   | Fixed    | The server refuses to boot with the built-in development secrets or `DEV_LOGIN` unless `API_PUBLIC_URL` is a loopback host, whatever `NODE_ENV` says.                                                                                                                          | `unit/env.test.ts`                                                        |
| 3   | Fixed    | Scan cache is an LRU capped at 64 MiB with expiry; one scan downloads at most 20 MiB; the scan route has its own `import` bucket (10/min).                                                                                                                                     | `unit/github-cache.test.ts`                                               |
| 4   | Fixed    | Public routes without a bucket use `public` (120/min per IP). Health probes opt out. `get-session` moved out of the tight sign-in bucket.                                                                                                                                      | `integration/rate-limit.test.ts`                                          |
| 5   | Fixed    | Both caps count and insert inside one transaction holding a per-IP / per-account advisory lock.                                                                                                                                                                                | covered by existing cli-auth and connect-token tests                      |
| 6   | Accepted | Share ids are client-generated random UUIDs (they are part of the encryption AAD). Guessing another account's id is infeasible (122 random bits).                                                                                                                              | —                                                                         |
| 7   | Fixed    | `lastSeenWrites` drops entries older than its 60 s window once it holds 10 000.                                                                                                                                                                                                | —                                                                         |
| 8   | Fixed    | `TRUST_PROXY` trusts exactly one hop (Caddy); client-written `X-Forwarded-For` entries are ignored. The API container publishes no ports.                                                                                                                                      | `unit/trust-proxy.test.ts`                                                |
