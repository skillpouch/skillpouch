# Graph Report - .  (2026-10-07)

## Corpus Check
- 336 files · ~163,037 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 1899 nodes · 5198 edges · 79 communities detected
- Extraction: 100% EXTRACTED · 0% INFERRED · 0% AMBIGUOUS
- Token cost: 0 input · 0 output
- Edge kinds: imports: 1488 · contains: 1426 · imports_from: 1034 · MODIFIES: 649 · calls: 353 · method: 104 · references: 52 · ON_BRANCH: 39 · PARENT_OF: 38 · cites: 9 · inherits: 4 · implements: 2


## Input Scope
- Requested: auto
- Resolved: committed (source: default-auto)
- Included files: 336 · Candidates: 386
- Excluded: 0 untracked · 71935 ignored · 8 sensitive · 0 missing committed
- Recommendation: Use --scope all or graphify.yaml inputs.corpus for a knowledge-base folder.

## Graph Freshness
- Built from Git commit: `91778b7`
- Compare this hash to `git rev-parse HEAD` before trusting freshness-sensitive graph output.
## God Nodes (most connected - your core abstractions)
1. `Deps` - 43 edges
2. `AppError` - 39 edges
3. `cn()` - 34 edges
4. `Button()` - 31 edges
5. `withTenantTx()` - 26 edges
6. `ZodApp` - 25 edges
7. `api` - 19 edges
8. `Harness` - 18 edges
9. `storage_accounts` - 17 edges
10. `principalOf()` - 16 edges

## Surprising Connections (you probably didn't know these)
- `userDetail()` --calls--> `findUser()`  [EXTRACTED]
  apps/api/src/modules/admin/admin.service.ts → apps/api/src/modules/admin/admin.service.ts  _Bridges community 8 → community 38_
- `033ee44 chore: monorepo foundations and @skillpouch/contracts` --ON_BRANCH--> `main`  [EXTRACTED]
  git → git  _Bridges community 27 → community 4_
- `033ee44 chore: monorepo foundations and @skillpouch/contracts` --PARENT_OF--> `fc3acb0 feat(db): schema, RLS, migration runner and catalog tests`  [EXTRACTED]
  git → git  _Bridges community 27 → community 43_
- `05a8064 perf+fix: load-test sandbox (tools/load: production image, seeded 100k accounts, DPoP CLI driver) and what it found — Postgres 16 refuses BYPASSRLS roles from the app login (created at init now), blob volume not writable by the API user, long-poll wait 25→55 s with subscribe-before-read (one DB read per idle poll), one-query device status, cached JWK imports, cached pouch-lock gate, bounded caches, accept backlog 4096, SSE streams re-authenticate every 4–5 min, refresh retries within 60 s are not reuse, access tokens 15 min (revocation is checked per request)` --ON_BRANCH--> `main`  [EXTRACTED]
  git → git  _Bridges community 14 → community 4_
- `05a8064 perf+fix: load-test sandbox (tools/load: production image, seeded 100k accounts, DPoP CLI driver) and what it found — Postgres 16 refuses BYPASSRLS roles from the app login (created at init now), blob volume not writable by the API user, long-poll wait 25→55 s with subscribe-before-read (one DB read per idle poll), one-query device status, cached JWK imports, cached pouch-lock gate, bounded caches, accept backlog 4096, SSE streams re-authenticate every 4–5 min, refresh retries within 60 s are not reuse, access tokens 15 min (revocation is checked per request)` --PARENT_OF--> `d9fc9d7 chore: lint`  [EXTRACTED]
  git → git  _Bridges community 14 → community 0_

## Communities

### Community 0 - "Community 0"
Cohesion: 0.04
Nodes (62): router, assertValidKey(), BlobKey, BlobStore, 22a69ed perf: load shedding — 503 server_busy with jittered Retry-After while the event loop lags (LOAD_SHED_LAG_MS, default 500 ms); health probes exempt, 30710bc chore: drop internal plan references from comments, docs and API descriptions (the plans are not part of this repository), 41d7ef9 feat(api): sync protocol — blobs, commits, conflicts, events, snapshots, artifacts, bindings, checkpoints (+ integration tests), 91778b7 perf: SSE streams recycle every 10–15 min; load driver uses separate unlimited pools for streams and requests; tools/load/REPORT.md (100k devices across 4 APIs: commit p95 69 ms, 0 commit errors) (+54 more)

### Community 1 - "Community 1"
Cohesion: 0.06
Nodes (40): Logo(), 269c6e5 feat(web): dashboard app — sign-in, setup, unlock, pouches, ingredients editor, devices + Connect CLI, shares, storage, security, billing; client-side E2EE via @skillpouch/crypto; unit tests, CodeEditor(), CodeMirror, EMPTY, IngredientSheet(), IngredientSheetProps, SheetMode (+32 more)

### Community 2 - "Community 2"
Cohesion: 0.07
Nodes (49): api, KeyEnvelopeRecord, Me, e5e7f16 test(web): Playwright e2e fixtures and auth specs (redirects, onboarding, unlock by password/Recovery Key, new browsers, sign out); fix: an untrusted browser now asks for the secret again after a reload, AuthHeading(), AuthLayout(), AuthSession, BootstrapOptions (+41 more)

### Community 3 - "Community 3"
Cohesion: 0.08
Nodes (23): UserDetail, UserParam, Invoice, InvoiceList, SubscriptionView, BlobParams, AuthInternals, DevLoginBody (+15 more)

### Community 4 - "Community 4"
Cohesion: 0.06
Nodes (35): main, 022fd20 fix(web): lazy pages via React.lazy (no conditional use() warnings), 067333a fix: changing the master password or Recovery Key failed in the browser (intermediate roster state rejected by the one-password/one-recovery check); fix(web): a stale cached `me` overwrote fresh session data (account deletion banner never appeared); test(web): e2e security, account deletion, billing, cross-account isolation; test(crypto): secret member replacement, 113710b test(web): e2e connect a computer (one-time token, single use, authorize link with matching confirm code, deny) and manage computers (assistants shown, rename, revoke cuts the CLI off) with a DPoP fake CLI, 1d2fd4e chore(engram): refresh code graph, 26ff243 feat(api,web): dev-only plan switch (/v1/dev/plan + window.__skillpouchDev) for trying limits; fix: nightly usage recount now includes share bundles; test: quota counts every pouch and deleting a locked pouch outright lifts it; e2e pouches spec, 4040b5c chore(engram): update code graph after backend milestone, 4525d23 ci: web end-to-end job (Playwright desktop + phone against the real API and Postgres, report uploaded on failure); perf(web): code-split every page (entry 955 kB → 403 kB) (+27 more)

### Community 5 - "Community 5"
Cohesion: 0.09
Nodes (29): EVENT_LABELS, TRUST_OPTIONS, SecurityEventRecord, SecuritySettingsRecord, RecoveryKeyCard(), EXPIRY_OPTIONS, ShareDialog(), PageHeader() (+21 more)

### Community 6 - "Community 6"
Cohesion: 0.06
Nodes (33): RevisionRow, 0e20e05 feat(api): downgrade handling — locked pouches (CLI cannot sync or switch to them, web read-only with deletes), Make active swap, storage usage breakdown, Free up space (history/trash, deleted items, skip_undo pouch delete), deletes always allowed over quota, 8f8571d chore(engram): refresh code graph, applyPouchLimit(), PlanRow, refreshEntitlementsInTx(), toLimits(), PlanLimits (+25 more)

### Community 7 - "Community 7"
Cohesion: 0.08
Nodes (40): blobAad(), openBlob(), sealBlob(), SealedBlob, concat(), decoder, encoder, exact() (+32 more)

### Community 8 - "Community 8"
Cohesion: 0.06
Nodes (19): listUsers(), PlanInput, PlanRow, userDetail(), userRows(), RFC-3339, AppError, isAppError() (+11 more)

### Community 9 - "Community 9"
Cohesion: 0.08
Nodes (30): Avatar(), describeError(), IngredientRowActions, IngredientTable(), IngredientTableProps, MakeActiveDialog(), NewPouchDialog(), PouchCard() (+22 more)

### Community 10 - "Community 10"
Cohesion: 0.07
Nodes (34): cancelCliAuthRequest(), finishRedeem(), getCliAuthRequest(), getConnectToken(), isExpired(), loadConnectToken(), loadRequest(), redeemCliAuthRequest() (+26 more)

### Community 11 - "Community 11"
Cohesion: 0.08
Nodes (36): BrowserRecord, CliAuthRequest, ConnectToken, ConnectTokenState, DeviceRecord, MemberRecord, PouchEventRecord, PouchRecord (+28 more)

### Community 12 - "Community 12"
Cohesion: 0.11
Nodes (17): loadEnv(), BrowserClient, signIn(), envelopesFor(), MemberHandle, Account, accountIdOf(), authorizeCli() (+9 more)

### Community 13 - "Community 13"
Cohesion: 0.05
Nodes (38): AccountLayout, accountRoute, appRoute, BillingPage, billingRoute, CliAuthorizePage, cliAuthorizeRoute, DevicesPage (+30 more)

### Community 14 - "Community 14"
Cohesion: 0.08
Nodes (27): 05a8064 perf+fix: load-test sandbox (tools/load: production image, seeded 100k accounts, DPoP CLI driver) and what it found — Postgres 16 refuses BYPASSRLS roles from the app login (created at init now), blob volume not writable by the API user, long-poll wait 25→55 s with subscribe-before-read (one DB read per idle poll), one-query device status, cached JWK imports, cached pouch-lock gate, bounded caches, accept backlog 4096, SSE streams re-authenticate every 4–5 min, refresh retries within 60 s are not reuse, access tokens 15 min (revocation is checked per request), e68977a security: fixes from the red-team review — link CLI logins require the terminal's code (anti-phishing), dev secrets refused on public hosts, bounded GitHub scan cache + import bucket, per-IP limit on every public route, race-free caps (advisory locks), bounded last-seen map, one trusted proxy hop; report in security/redteam, AuthMode, fastify, FastifyContextConfig, FastifyRequest, RateLimitBucket, SkillpouchRouteConfig (+19 more)

### Community 15 - "Community 15"
Cohesion: 0.13
Nodes (26): RFC-9562, SseFrame, BaseClient, b64(), keyEnvelope(), memberJson(), newMember(), randomBlobId() (+18 more)

### Community 16 - "Community 16"
Cohesion: 0.13
Nodes (37): account_members, account_unlock, accounts, artifacts, audit_log, billing_events, bindings, blobs (+29 more)

### Community 17 - "Community 17"
Cohesion: 0.09
Nodes (24): INVOICE_STATUS, BillingOverview, Invoice, PlanRecord, openInvoicePdf(), useBilling(), useCheckout(), useInvoices() (+16 more)

### Community 18 - "Community 18"
Cohesion: 0.09
Nodes (26): AccountBanners(), SECTIONS, AccountMenu(), SupporterPill(), ConnectCliDialog(), PouchSwitcher(), AppShell(), AppShellProps (+18 more)

### Community 19 - "Community 19"
Cohesion: 0.10
Nodes (23): exec, LONG_POLL_SECONDS, main(), merge(), resetDevices(), runWorker(), sampleServer(), sleep() (+15 more)

### Community 20 - "Community 20"
Cohesion: 0.10
Nodes (30): advance(), buildAddMember(), buildAuthorizeCli(), buildCreatePouch(), buildGenesis(), buildRemoveMember(), buildRenamePouch(), buildReplaceSecretMember() (+22 more)

### Community 21 - "Community 21"
Cohesion: 0.11
Nodes (21): d308558 feat(crypto): @skillpouch/crypto — client-side E2EE (sealed objects, Padmé, pouch key hierarchy, keyed blob ids, blind name index, HPKE key envelopes, signed roster verification, revision envelopes, secret-derived members via Argon2id/HKDF, 12-word Recovery Key, CLI confirm code + welcome, share bundles) with flow tests and v1 test vectors; browser-safe base64url in contracts, RFC-9180, target, confirmCode(), WELCOME_INFO, CryptoErrorKind, hpkeOpen(), HpkeRecipientKey (+13 more)

### Community 22 - "Community 22"
Cohesion: 0.14
Nodes (26): gcBlobs(), gcPending(), expireBrowserTrust(), expireCliAuthRequests(), expireShares(), flagStaleDevices(), purgeEphemeral(), recalcUsage() (+18 more)

### Community 23 - "Community 23"
Cohesion: 0.09
Nodes (20): blobIdBytes(), getBlob(), putBlob(), openEventStream(), parseCursors(), Principal, SessionPrincipal, assertOpenable() (+12 more)

### Community 24 - "Community 24"
Cohesion: 0.08
Nodes (18): Auth, AuthDeps, createAuth(), applyPendingBillingEvents(), applySubscription(), markBillingEventProcessed(), reconcileSubscriptions(), TERMINAL (+10 more)

### Community 25 - "Community 25"
Cohesion: 0.11
Nodes (21): buildPath(), fetchApi(), json(), QueryValue, readError(), rememberNonce(), RequestOptions, send() (+13 more)

### Community 26 - "Community 26"
Cohesion: 0.13
Nodes (16): BillingProvider, dateOrNull(), header(), normalizePolarOrder(), normalizePolarSubscription(), ORDER_STATUSES, PolarOptions, PolarProvider (+8 more)

### Community 27 - "Community 27"
Cohesion: 0.11
Nodes (17): 033ee44 chore: monorepo foundations and @skillpouch/contracts, 5da26a8 feat(api): share links (sealed in the browser, key only in the link fragment; owner list/revoke, public metadata and bundle, one-time claim, counters, quota accounting, expiry job, single-row RLS policy for recipients) and billing invoices (Polar orders, PDF links only for the account's own generated invoices), a80df06 feat(api): mount Better Auth under /v1/auth, dev-only email sign-in, one-time connect tokens for `npx skillpouch login <token>`, device rename, detected assistants and per-pouch sync cursors on the Devices list, ErrorCode, errorCodeList, ErrorDef, errorDocsUrl(), packageRoot (+9 more)

### Community 28 - "Community 28"
Cohesion: 0.07
Nodes (27): AccountEventType, Artifact, ArtifactListQuery, Binding, BindingsPut, BlobBatchResponse, BlobCheckRequest, BlobCheckResponse (+19 more)

### Community 29 - "Community 29"
Cohesion: 0.13
Nodes (21): FileTree(), FileTreeProps, MARKERS, TreeNode, changedCount(), conflictProblem(), createDraft(), Draft (+13 more)

### Community 30 - "Community 30"
Cohesion: 0.07
Nodes (26): ActivePouchReport, ArtifactUsage, AssistantId, BrowserMember, ClientSecurityReport, CliLatest, CursorReport, Device (+18 more)

### Community 31 - "Community 31"
Cohesion: 0.09
Nodes (8): browserTrustDays(), concatBytes(), revisionSignedMessage(), verifyMemberSignature(), commitPendingUnlock(), DEFAULT_KDF_PARAMS, lockUnlockRow(), ROSTER_FOLLOW_UPS

### Community 32 - "Community 32"
Cohesion: 0.11
Nodes (20): RFC-7517, b64urlBytes(), DeviceOs, Hash32, IdParam, KeyStorage, P256PublicJwk, PageQuery (+12 more)

### Community 33 - "Community 33"
Cohesion: 0.13
Nodes (18): billingEvents, entitlementOverrides, EntitlementsJson, planGrants, plans, storageAccounts, subscriptions, accounts (+10 more)

### Community 34 - "Community 34"
Cohesion: 0.10
Nodes (20): KeyEnvelopeInput, BrowserEnrollRequest, KdfParams, MasterPasswordChange, PasskeyAssertRequest, PasskeyAssertResponse, PasskeyOptionsResponse, PasskeyRegisterRequest (+12 more)

### Community 35 - "Community 35"
Cohesion: 0.20
Nodes (15): applyOne(), applyWithRetry(), loadMigrations(), migrate(), MigrateOptions, MigrationFile, MIGRATIONS_DIR, splitStatements() (+7 more)

### Community 36 - "Community 36"
Cohesion: 0.14
Nodes (20): activeAt(), activeMembers(), addMember(), applyStatement(), cloneState(), countActive(), headOf(), isActive() (+12 more)

### Community 37 - "Community 37"
Cohesion: 0.13
Nodes (15): FreeSpaceResult, OperationResultRecord, StorageUsageRecord, Ingredient, CommitConflictError, commitIngredient(), CommitInput, CommitRejectedError (+7 more)

### Community 38 - "Community 38"
Cohesion: 0.22
Nodes (18): audit(), clearOverride(), createPlan(), findUser(), grantPlan(), planView(), refreshAccount(), requireAccount() (+10 more)

### Community 39 - "Community 39"
Cohesion: 0.15
Nodes (11): basename(), detectItems(), dirname(), GithubImporter, ImportKind, INSTRUCTION_FILES, MCP_FILES, ScannedFile (+3 more)

### Community 40 - "Community 40"
Cohesion: 0.21
Nodes (11): GitHubIcon(), GoogleIcon(), BEAMS, authPost(), devSignIn(), OAuthProvider, reauthenticate(), rememberProvider() (+3 more)

### Community 41 - "Community 41"
Cohesion: 0.12
Nodes (16): Entitlements, AdminGrantPlan, AdminOverview, AdminPlan, AdminPlanInput, AdminReason, AdminSetOverride, AdminSetRole (+8 more)

### Community 42 - "Community 42"
Cohesion: 0.13
Nodes (15): artifacts, bindings, blobs, checkpoints, conflicts, ConflictType, deviceCursors, events (+7 more)

### Community 43 - "Community 43"
Cohesion: 0.17
Nodes (6): fc3acb0 feat(db): schema, RLS, migration runner and catalog tests, createPool(), Database, DbRole, PoolOptions, PRE_TENANT_TABLES

### Community 44 - "Community 44"
Cohesion: 0.13
Nodes (14): CliAuthApprove, CliAuthCreate, CliAuthCreated, CliAuthRequestView, CliAuthTokenRequest, CliAuthTokenResponse, ConnectTokenCreated, ConnectTokenStatus (+6 more)

### Community 45 - "Community 45"
Cohesion: 0.16
Nodes (11): ArtifactRecord, RevisionRecord, ConflictRecord, fetchAllArtifacts(), fetchBlobs(), fetchIngredientFiles(), loadPouchContents(), PouchContents (+3 more)

### Community 46 - "Community 46"
Cohesion: 0.16
Nodes (11): PublicShareRecord, ShareRecord, claimOneTimeShare(), fetchPublicShare(), labelAad(), openReusableShare(), openShareLabel(), sealShareLabel() (+3 more)

### Community 47 - "Community 47"
Cohesion: 0.22
Nodes (11): RFC-7638, deriveMemberKeyPair(), deriveScalar(), ECDH, ECDSA, generateMemberKeyPair(), importScalar(), requireSignature() (+3 more)

### Community 48 - "Community 48"
Cohesion: 0.20
Nodes (9): usePouchContents(), BY_KIND, BY_SLUG, IngredientKind, isIngredientKind(), KindDefinition, KINDS, CommandPalette() (+1 more)

### Community 49 - "Community 49"
Cohesion: 0.29
Nodes (3): BlobStore, FsBlobStore, fsyncDir()

### Community 50 - "Community 50"
Cohesion: 0.18
Nodes (1): ListenHub

### Community 51 - "Community 51"
Cohesion: 0.18
Nodes (10): accountMembers, accountUnlock, KdfParams, keyEnvelopes, MEMBER_KINDS, MemberKind, passkeyUnlockers, rosterStatements (+2 more)

### Community 52 - "Community 52"
Cohesion: 0.18
Nodes (10): B64Url, b64urlMax(), Timestamp, PublicShare, Share, ShareClaim, ShareCreate, ShareExpiry (+2 more)

### Community 53 - "Community 53"
Cohesion: 0.25
Nodes (10): buildPouchKeys(), deriveGeneration(), deriveKey(), foldName(), nameIndex(), newPouchSecrets(), packSecrets(), PouchGeneration (+2 more)

### Community 54 - "Community 54"
Cohesion: 0.20
Nodes (5): 3289da2 perf(sql): storage usage aggregates in one pass (heavy account: 4.4 s → 21 ms per pouch, minutes → 157 ms per item); retention/free-space collect open-conflict pins once; indexes for jobs and admin (built CONCURRENTLY); browser-trust prefilter; TABLESAMPLE integrity sample; admin pouch sizes use the blob key; fix(db): no-transaction migrations run one statement at a time without a statement timeout; tools/perf/sql, big, findings, perf, stats

### Community 55 - "Community 55"
Cohesion: 0.27
Nodes (7): c398dbc test(api): end-to-end journey over a real socket (SSE, long-poll, unlock, revoke, shutdown), ApiResponse, nonces, overSocket(), parse(), request(), RequestOptions

### Community 56 - "Community 56"
Cohesion: 0.33
Nodes (8): asText(), decoder, describe(), fillSecrets(), frontmatter(), languageOf(), stripSecrets(), kindBySlug()

### Community 57 - "Community 57"
Cohesion: 0.42
Nodes (3): b64(), sha256(), SoftAuthenticator

### Community 58 - "Community 58"
Cohesion: 0.22
Nodes (8): tenantColumn(), cliAuthRequests, CliAuthState, cliConnectTokens, deviceKeys, devices, DeviceState, dpopReplay

### Community 59 - "Community 59"
Cohesion: 0.33
Nodes (7): currentKeyring(), bundleFiles(), DuplicateChoice, freeName(), importBundle(), keyFromHash(), recordImport()

### Community 60 - "Community 60"
Cohesion: 0.29
Nodes (4): CodeMirrorProps, highlight, theme, FileLanguage

### Community 61 - "Community 61"
Cohesion: 0.38
Nodes (1): SseConnection

### Community 62 - "Community 62"
Cohesion: 0.43
Nodes (6): PouchRef, useCreateIngredient(), useDeleteIngredient(), useInvalidateContents(), useUpdateIngredient(), DraftFile

### Community 63 - "Community 63"
Cohesion: 0.38
Nodes (1): DeviceStatusCache

### Community 64 - "Community 64"
Cohesion: 0.33
Nodes (5): RootLayout(), UnlockedRoot(), useAccountEvents(), useMeSync(), Toaster()

### Community 65 - "Community 65"
Cohesion: 0.53
Nodes (1): TenantBlobStore

### Community 66 - "Community 66"
Cohesion: 0.60
Nodes (1): NonceService

### Community 67 - "Community 67"
Cohesion: 0.47
Nodes (2): aad(), PepperBox

### Community 68 - "Community 68"
Cohesion: 0.33
Nodes (1): LOOKUP

### Community 69 - "Community 69"
Cohesion: 0.47
Nodes (3): FakeServer, params, setup()

### Community 70 - "Community 70"
Cohesion: 0.50
Nodes (4): createDpopProof(), DpopKey, encodeJson(), RFC-9449

### Community 71 - "Community 71"
Cohesion: 0.40
Nodes (3): api, apiDir, blobRoot

### Community 72 - "Community 72"
Cohesion: 0.40
Nodes (1): CliClient

### Community 73 - "Community 73"
Cohesion: 0.50
Nodes (1): TestKey

### Community 74 - "Community 74"
Cohesion: 0.40
Nodes (3): DevTools, Window, queryClient

### Community 75 - "Community 75"
Cohesion: 0.50
Nodes (1): TtlCache

### Community 76 - "Community 76"
Cohesion: 0.50
Nodes (1): SettingsCache

### Community 77 - "Community 77"
Cohesion: 1.00
Nodes (3): destination(), isAppPath(), SessionGate()

### Community 78 - "Community 78"
Cohesion: 1.00
Nodes (2): canonicalDigest(), canonicalJson()

## Knowledge Gaps
- **449 isolated node(s):** `OUTPUT`, `env`, `bool`, `EnvSchema`, `SECRET_KEYS` (+444 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **Thin community `Community 50`** (1 nodes): `ListenHub`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 61`** (1 nodes): `SseConnection`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 63`** (1 nodes): `DeviceStatusCache`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 65`** (1 nodes): `TenantBlobStore`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 66`** (1 nodes): `NonceService`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 67`** (2 nodes): `aad()`, `PepperBox`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 68`** (1 nodes): `LOOKUP`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 72`** (1 nodes): `CliClient`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 73`** (1 nodes): `TestKey`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 75`** (1 nodes): `TtlCache`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 76`** (1 nodes): `SettingsCache`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 78`** (2 nodes): `canonicalDigest()`, `canonicalJson()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `PouchView` connect `Community 9` to `Community 1`, `Community 3`, `Community 59`?**
  _High betweenness centrality (0.014) - this node is a cross-community bridge._
- **Why does `PolarProvider` connect `Community 26` to `Community 12`, `Community 3`?**
  _High betweenness centrality (0.011) - this node is a cross-community bridge._
- **Why does `ListenHub` connect `Community 50` to `Community 0`, `Community 3`?**
  _High betweenness centrality (0.011) - this node is a cross-community bridge._
- **What connects `OUTPUT`, `env`, `bool` to the rest of the system?**
  _449 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Community 0` be split into smaller, more focused modules?**
  _Cohesion score 0.04392587508579272 - nodes in this community are weakly interconnected._
- **Should `Community 1` be split into smaller, more focused modules?**
  _Cohesion score 0.06164383561643835 - nodes in this community are weakly interconnected._
- **Should `Community 2` be split into smaller, more focused modules?**
  _Cohesion score 0.07067307692307692 - nodes in this community are weakly interconnected._