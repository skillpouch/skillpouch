# Graph Report - .  (2026-10-06)

## Corpus Check
- 316 files · ~150,294 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 1818 nodes · 4994 edges · 76 communities detected
- Extraction: 100% EXTRACTED · 0% INFERRED · 0% AMBIGUOUS
- Token cost: 0 input · 0 output
- Edge kinds: imports: 1458 · contains: 1385 · imports_from: 1016 · MODIFIES: 589 · calls: 328 · method: 88 · references: 52 · ON_BRANCH: 32 · PARENT_OF: 31 · cites: 9 · inherits: 4 · implements: 2


## Input Scope
- Requested: auto
- Resolved: committed (source: default-auto)
- Included files: 316 · Candidates: 362
- Excluded: 0 untracked · 62147 ignored · 8 sensitive · 0 missing committed
- Recommendation: Use --scope all or graphify.yaml inputs.corpus for a knowledge-base folder.

## Graph Freshness
- Built from Git commit: `022fd20`
- Compare this hash to `git rev-parse HEAD` before trusting freshness-sensitive graph output.
## God Nodes (most connected - your core abstractions)
1. `Deps` - 43 edges
2. `AppError` - 38 edges
3. `cn()` - 34 edges
4. `Button()` - 31 edges
5. `withTenantTx()` - 26 edges
6. `ZodApp` - 25 edges
7. `api` - 19 edges
8. `storage_accounts` - 17 edges
9. `principalOf()` - 16 edges
10. `appendAudit()` - 15 edges

## Surprising Connections (you probably didn't know these)
- `userDetail()` --calls--> `findUser()`  [EXTRACTED]
  apps/api/src/modules/admin/admin.service.ts → apps/api/src/modules/admin/admin.service.ts  _Bridges community 28 → community 38_
- `033ee44 chore: monorepo foundations and @skillpouch/contracts` --ON_BRANCH--> `main`  [EXTRACTED]
  git → git  _Bridges community 45 → community 2_
- `033ee44 chore: monorepo foundations and @skillpouch/contracts` --PARENT_OF--> `fc3acb0 feat(db): schema, RLS, migration runner and catalog tests`  [EXTRACTED]
  git → git  _Bridges community 45 → community 50_
- `0e20e05 feat(api): downgrade handling — locked pouches (CLI cannot sync or switch to them, web read-only with deletes), Make active swap, storage usage breakdown, Free up space (history/trash, deleted items, skip_undo pouch delete), deletes always allowed over quota` --ON_BRANCH--> `main`  [EXTRACTED]
  git → git  _Bridges community 16 → community 2_
- `1d2fd4e chore(engram): refresh code graph` --ON_BRANCH--> `main`  [EXTRACTED]
  git → git  _Bridges community 25 → community 2_

## Communities

### Community 0 - "Community 0"
Cohesion: 0.06
Nodes (39): describeError(), isApiError(), MESSAGES, Logo(), 269c6e5 feat(web): dashboard app — sign-in, setup, unlock, pouches, ingredients editor, devices + Connect CLI, shares, storage, security, billing; client-side E2EE via @skillpouch/crypto; unit tests, PouchMetaFields(), AuthHeading(), AuthLayout() (+31 more)

### Community 1 - "Community 1"
Cohesion: 0.08
Nodes (27): UserDetail, UserParam, Invoice, InvoiceList, SubscriptionView, BlobParams, AuthInternals, DevLoginBody (+19 more)

### Community 2 - "Community 2"
Cohesion: 0.06
Nodes (34): main, 022fd20 fix(web): lazy pages via React.lazy (no conditional use() warnings), 067333a fix: changing the master password or Recovery Key failed in the browser (intermediate roster state rejected by the one-password/one-recovery check); fix(web): a stale cached `me` overwrote fresh session data (account deletion banner never appeared); test(web): e2e security, account deletion, billing, cross-account isolation; test(crypto): secret member replacement, 113710b test(web): e2e connect a computer (one-time token, single use, authorize link with matching confirm code, deny) and manage computers (assistants shown, rename, revoke cuts the CLI off) with a DPoP fake CLI, 26ff243 feat(api,web): dev-only plan switch (/v1/dev/plan + window.__skillpouchDev) for trying limits; fix: nightly usage recount now includes share bundles; test: quota counts every pouch and deleting a locked pouch outright lifts it; e2e pouches spec, 4040b5c chore(engram): update code graph after backend milestone, 4525d23 ci: web end-to-end job (Playwright desktop + phone against the real API and Postgres, report uploaded on failure); perf(web): code-split every page (entry 955 kB → 403 kB), 69e1c91 build(api): ship migrations inside the bundle; CI boots the worker and the env-free bundle (+26 more)

### Community 3 - "Community 3"
Cohesion: 0.09
Nodes (38): api, KeyEnvelopeRecord, Me, AuthSession, BootstrapOptions, bootstrapSession(), endRevokedBrowser(), findBrowserMember() (+30 more)

### Community 4 - "Community 4"
Cohesion: 0.08
Nodes (31): assertValidKey(), BlobKey, BlobStore, 30710bc chore: drop internal plan references from comments, docs and API descriptions (the plans are not part of this repository), 41d7ef9 feat(api): sync protocol — blobs, commits, conflicts, events, snapshots, artifacts, bindings, checkpoints (+ integration tests), a1730a9 feat(api): server foundation, security core, roster, pouches, CLI authorize, devices, account, f4707a7 feat(api): master-password/passkey/Recovery Key unlock, trusted browsers, roster invariants (+ tests), HealthState (+23 more)

### Community 5 - "Community 5"
Cohesion: 0.06
Nodes (25): RFC-3339, openEventStream(), parseCursors(), addSeconds(), assertCommitAllowed(), assertWritable(), findPouch(), findWritablePouch() (+17 more)

### Community 6 - "Community 6"
Cohesion: 0.06
Nodes (27): RevisionRow, formatRefreshToken(), issueDeviceTokens(), ParsedRefreshToken, parseRefreshToken(), refreshDeviceTokens(), NewEvent, Executor (+19 more)

### Community 7 - "Community 7"
Cohesion: 0.08
Nodes (32): BrowserRecord, DeviceRecord, PouchRecord, BrowserRow(), ComputerRow(), OS_ICON, PouchCard(), PouchCardProps (+24 more)

### Community 8 - "Community 8"
Cohesion: 0.07
Nodes (33): cancelCliAuthRequest(), finishRedeem(), getCliAuthRequest(), getConnectToken(), isExpired(), loadConnectToken(), loadRequest(), redeemCliAuthRequest() (+25 more)

### Community 9 - "Community 9"
Cohesion: 0.10
Nodes (33): 5da26a8 feat(api): share links (sealed in the browser, key only in the link fragment; owner list/revoke, public metadata and bundle, one-time claim, counters, quota accounting, expiry job, single-row RLS policy for recipients) and billing invoices (Polar orders, PDF links only for the account's own generated invoices), a80df06 feat(api): mount Better Auth under /v1/auth, dev-only email sign-in, one-time connect tokens for `npx skillpouch login <token>`, device rename, detected assistants and per-pouch sync cursors on the Devices list, ea262f2 chore(engram): initial code graph (portable graph.json + GRAPH_REPORT.md), f2015e2 feat(api): worker jobs, billing (Polar), admin dashboard API, GitHub import, metrics, entrypoints (+ tests), ErrorCode, ErrorDef, errorDocsUrl(), gcBlobs() (+25 more)

### Community 10 - "Community 10"
Cohesion: 0.10
Nodes (28): RFC-9562, SseFrame, BaseClient, CliClient, b64(), envelopesFor(), keyEnvelope(), memberJson() (+20 more)

### Community 11 - "Community 11"
Cohesion: 0.05
Nodes (38): AccountLayout, accountRoute, appRoute, BillingPage, billingRoute, CliAuthorizePage, cliAuthorizeRoute, DevicesPage (+30 more)

### Community 12 - "Community 12"
Cohesion: 0.07
Nodes (30): AccountBanners(), SECTIONS, AccountMenu(), SupporterPill(), ConnectCliDialog(), PouchSwitcher(), usePouchContents(), KINDS (+22 more)

### Community 13 - "Community 13"
Cohesion: 0.09
Nodes (34): concat(), decoder, encoder, exact(), fromUtf8(), randomBytes(), readU32be(), u32be() (+26 more)

### Community 14 - "Community 14"
Cohesion: 0.09
Nodes (26): CodeEditor(), CodeMirror, EMPTY, IngredientSheet(), IngredientSheetProps, SheetMode, RecoveryKeyCard(), EXPIRY_OPTIONS (+18 more)

### Community 15 - "Community 15"
Cohesion: 0.10
Nodes (23): Avatar(), IngredientRowActions, IngredientTable(), IngredientTableProps, MakeActiveDialog(), NewPouchDialog(), PouchMonogram(), PouchRecord (+15 more)

### Community 16 - "Community 16"
Cohesion: 0.08
Nodes (27): 0e20e05 feat(api): downgrade handling — locked pouches (CLI cannot sync or switch to them, web read-only with deletes), Make active swap, storage usage breakdown, Free up space (history/trash, deleted items, skip_undo pouch delete), deletes always allowed over quota, 8f8571d chore(engram): refresh code graph, AuthMode, fastify, FastifyContextConfig, FastifyRequest, RateLimitBucket, SkillpouchRouteConfig (+19 more)

### Community 17 - "Community 17"
Cohesion: 0.13
Nodes (15): BrowserClient, signIn(), MemberHandle, Account, accountIdOf(), authorizeCli(), createPouch(), newId() (+7 more)

### Community 18 - "Community 18"
Cohesion: 0.13
Nodes (37): account_members, account_unlock, accounts, artifacts, audit_log, billing_events, bindings, blobs (+29 more)

### Community 19 - "Community 19"
Cohesion: 0.09
Nodes (24): EVENT_LABELS, TRUST_OPTIONS, CliAuthRequest, ConnectToken, ConnectTokenState, MemberRecord, OperationResultRecord, PouchEventRecord (+16 more)

### Community 20 - "Community 20"
Cohesion: 0.08
Nodes (25): queryKeys, ArtifactRecord, FreeSpaceResult, RevisionRecord, StorageUsageRecord, ConflictRecord, fetchAllArtifacts(), fetchBlobs() (+17 more)

### Community 21 - "Community 21"
Cohesion: 0.11
Nodes (21): d308558 feat(crypto): @skillpouch/crypto — client-side E2EE (sealed objects, Padmé, pouch key hierarchy, keyed blob ids, blind name index, HPKE key envelopes, signed roster verification, revision envelopes, secret-derived members via Argon2id/HKDF, 12-word Recovery Key, CLI confirm code + welcome, share bundles) with flow tests and v1 test vectors; browser-safe base64url in contracts, RFC-9180, target, confirmCode(), WELCOME_INFO, CryptoErrorKind, hpkeOpen(), HpkeRecipientKey (+13 more)

### Community 22 - "Community 22"
Cohesion: 0.10
Nodes (21): INVOICE_STATUS, BillingOverview, Invoice, PlanRecord, openInvoicePdf(), useBilling(), useCheckout(), useInvoices() (+13 more)

### Community 23 - "Community 23"
Cohesion: 0.12
Nodes (21): bool, Env, EnvSchema, loadEnv(), readSecretFile(), resolveRaw(), SECRET_KEYS, secretFileName() (+13 more)

### Community 24 - "Community 24"
Cohesion: 0.10
Nodes (22): buildPath(), fetchApi(), json(), QueryValue, readError(), rememberNonce(), RequestOptions, send() (+14 more)

### Community 25 - "Community 25"
Cohesion: 0.12
Nodes (17): BillingProvider, dateOrNull(), header(), normalizePolarOrder(), normalizePolarSubscription(), ORDER_STATUSES, PolarOptions, PolarProvider (+9 more)

### Community 26 - "Community 26"
Cohesion: 0.07
Nodes (27): AccountEventType, Artifact, ArtifactListQuery, Binding, BindingsPut, BlobBatchResponse, BlobCheckRequest, BlobCheckResponse (+19 more)

### Community 27 - "Community 27"
Cohesion: 0.07
Nodes (26): ActivePouchReport, ArtifactUsage, AssistantId, BrowserMember, ClientSecurityReport, CliLatest, CursorReport, Device (+18 more)

### Community 28 - "Community 28"
Cohesion: 0.11
Nodes (10): listUsers(), PlanInput, PlanRow, userDetail(), userRows(), AppError, decodeCursor(), encodeCursor() (+2 more)

### Community 29 - "Community 29"
Cohesion: 0.11
Nodes (14): Auth, AuthDeps, createAuth(), applyPendingBillingEvents(), applySubscription(), markBillingEventProcessed(), reconcileSubscriptions(), TERMINAL (+6 more)

### Community 30 - "Community 30"
Cohesion: 0.09
Nodes (7): concatBytes(), revisionSignedMessage(), verifyMemberSignature(), commitPendingUnlock(), DEFAULT_KDF_PARAMS, lockUnlockRow(), ROSTER_FOLLOW_UPS

### Community 31 - "Community 31"
Cohesion: 0.17
Nodes (15): applyOne(), applyWithRetry(), loadMigrations(), migrate(), MigrateOptions, MigrationFile, MIGRATIONS_DIR, adminQuery() (+7 more)

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
Cohesion: 0.14
Nodes (20): activeAt(), activeMembers(), addMember(), applyStatement(), cloneState(), countActive(), headOf(), isActive() (+12 more)

### Community 36 - "Community 36"
Cohesion: 0.15
Nodes (14): PublicShareRecord, ShareRecord, KindDefinition, STATE_LABEL, STATE_TONE, claimOneTimeShare(), fetchPublicShare(), labelAad() (+6 more)

### Community 37 - "Community 37"
Cohesion: 0.19
Nodes (17): advance(), buildAddMember(), buildAuthorizeCli(), buildCreatePouch(), buildGenesis(), buildRemoveMember(), buildRenamePouch(), buildReplaceSecretMember() (+9 more)

### Community 38 - "Community 38"
Cohesion: 0.22
Nodes (18): audit(), clearOverride(), createPlan(), findUser(), grantPlan(), planView(), refreshAccount(), requireAccount() (+10 more)

### Community 39 - "Community 39"
Cohesion: 0.15
Nodes (13): applyPouchLimit(), PlanRow, refreshEntitlementsInTx(), toLimits(), GrantInput, isSubscriptionEntitled(), outranks(), OverrideInput (+5 more)

### Community 40 - "Community 40"
Cohesion: 0.17
Nodes (14): asText(), decoder, describe(), fillSecrets(), frontmatter(), LANGUAGE_LABEL, languageOf(), stripSecrets() (+6 more)

### Community 41 - "Community 41"
Cohesion: 0.21
Nodes (11): GitHubIcon(), GoogleIcon(), BEAMS, authPost(), devSignIn(), OAuthProvider, reauthenticate(), rememberProvider() (+3 more)

### Community 42 - "Community 42"
Cohesion: 0.24
Nodes (15): changedCount(), conflictProblem(), createDraft(), Draft, DraftAction, DraftError, draftFiles(), draftReducer() (+7 more)

### Community 43 - "Community 43"
Cohesion: 0.12
Nodes (16): Entitlements, AdminGrantPlan, AdminOverview, AdminPlan, AdminPlanInput, AdminReason, AdminSetOverride, AdminSetRole (+8 more)

### Community 44 - "Community 44"
Cohesion: 0.16
Nodes (13): binding(), openKeyEnvelope(), sealKeyEnvelope(), addMaterial(), createPouchSecrets(), Keyring, Member, openKeyring() (+5 more)

### Community 45 - "Community 45"
Cohesion: 0.19
Nodes (9): 033ee44 chore: monorepo foundations and @skillpouch/contracts, packageRoot, canonicalDigest(), canonicalJson(), renderErrorDocs(), renderGeneratedFiles(), LimitName, Limits (+1 more)

### Community 46 - "Community 46"
Cohesion: 0.18
Nodes (12): RFC-7638, CryptoError, deriveMemberKeyPair(), deriveScalar(), ECDH, ECDSA, generateMemberKeyPair(), importScalar() (+4 more)

### Community 47 - "Community 47"
Cohesion: 0.13
Nodes (15): artifacts, bindings, blobs, checkpoints, conflicts, ConflictType, deviceCursors, events (+7 more)

### Community 48 - "Community 48"
Cohesion: 0.17
Nodes (8): c398dbc test(api): end-to-end journey over a real socket (SSE, long-poll, unlock, revoke, shutdown), ApiResponse, nonces, overSocket(), parse(), request(), RequestOptions, TestKey

### Community 49 - "Community 49"
Cohesion: 0.13
Nodes (14): CliAuthApprove, CliAuthCreate, CliAuthCreated, CliAuthRequestView, CliAuthTokenRequest, CliAuthTokenResponse, ConnectTokenCreated, ConnectTokenStatus (+6 more)

### Community 50 - "Community 50"
Cohesion: 0.21
Nodes (5): fc3acb0 feat(db): schema, RLS, migration runner and catalog tests, createPool(), Database, DbRole, PoolOptions

### Community 51 - "Community 51"
Cohesion: 0.21
Nodes (8): IngredientKind, CommitConflictError, commitIngredient(), CommitInput, CommitRejectedError, encoder, OperationType, uploadBlobs()

### Community 52 - "Community 52"
Cohesion: 0.29
Nodes (3): BlobStore, FsBlobStore, fsyncDir()

### Community 53 - "Community 53"
Cohesion: 0.22
Nodes (10): basename(), detectItems(), dirname(), ImportKind, INSTRUCTION_FILES, MCP_FILES, ScannedFile, ScannedItem (+2 more)

### Community 54 - "Community 54"
Cohesion: 0.18
Nodes (10): accountMembers, accountUnlock, KdfParams, keyEnvelopes, MEMBER_KINDS, MemberKind, passkeyUnlockers, rosterStatements (+2 more)

### Community 55 - "Community 55"
Cohesion: 0.18
Nodes (10): B64Url, b64urlMax(), Timestamp, PublicShare, Share, ShareClaim, ShareCreate, ShareExpiry (+2 more)

### Community 56 - "Community 56"
Cohesion: 0.25
Nodes (10): buildPouchKeys(), deriveGeneration(), deriveKey(), foldName(), nameIndex(), newPouchSecrets(), packSecrets(), PouchGeneration (+2 more)

### Community 57 - "Community 57"
Cohesion: 0.20
Nodes (1): ListenHub

### Community 58 - "Community 58"
Cohesion: 0.22
Nodes (5): FileTree(), FileTreeProps, MARKERS, TreeNode, DraftEntry

### Community 59 - "Community 59"
Cohesion: 0.42
Nodes (3): b64(), sha256(), SoftAuthenticator

### Community 60 - "Community 60"
Cohesion: 0.33
Nodes (7): DraftFile, bundleFiles(), DuplicateChoice, freeName(), importBundle(), keyFromHash(), recordImport()

### Community 61 - "Community 61"
Cohesion: 0.22
Nodes (8): tenantColumn(), cliAuthRequests, CliAuthState, cliConnectTokens, deviceKeys, devices, DeviceState, dpopReplay

### Community 62 - "Community 62"
Cohesion: 0.32
Nodes (3): blobIdBytes(), getBlob(), putBlob()

### Community 63 - "Community 63"
Cohesion: 0.36
Nodes (5): destination(), GateRequirement, isAppPath(), SessionGate(), Target

### Community 64 - "Community 64"
Cohesion: 0.32
Nodes (5): blobAad(), openBlob(), sealBlob(), SealedBlob, blobId()

### Community 65 - "Community 65"
Cohesion: 0.29
Nodes (4): CodeMirrorProps, highlight, theme, FileLanguage

### Community 66 - "Community 66"
Cohesion: 0.38
Nodes (1): SseConnection

### Community 67 - "Community 67"
Cohesion: 0.29
Nodes (5): errorCodeList, Empty, ErrorBody, ErrorEnvelope, ResponseMeta

### Community 68 - "Community 68"
Cohesion: 0.43
Nodes (6): PouchRef, useCreateIngredient(), useDeleteIngredient(), useInvalidateContents(), useUpdateIngredient(), currentKeyring()

### Community 69 - "Community 69"
Cohesion: 0.53
Nodes (1): TenantBlobStore

### Community 70 - "Community 70"
Cohesion: 0.40
Nodes (1): DeviceStatusCache

### Community 71 - "Community 71"
Cohesion: 0.47
Nodes (2): aad(), PepperBox

### Community 72 - "Community 72"
Cohesion: 0.33
Nodes (1): LOOKUP

### Community 73 - "Community 73"
Cohesion: 0.40
Nodes (4): RootLayout(), UnlockedRoot(), useMeSync(), Toaster()

### Community 74 - "Community 74"
Cohesion: 0.40
Nodes (3): api, apiDir, blobRoot

### Community 75 - "Community 75"
Cohesion: 0.60
Nodes (1): GithubImporter

## Knowledge Gaps
- **438 isolated node(s):** `OUTPUT`, `env`, `bool`, `EnvSchema`, `SECRET_KEYS` (+433 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **Thin community `Community 57`** (1 nodes): `ListenHub`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 66`** (1 nodes): `SseConnection`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 69`** (1 nodes): `TenantBlobStore`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 70`** (1 nodes): `DeviceStatusCache`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 71`** (2 nodes): `aad()`, `PepperBox`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 72`** (1 nodes): `LOOKUP`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 75`** (1 nodes): `GithubImporter`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `PouchView` connect `Community 15` to `Community 14`, `Community 7`, `Community 1`, `Community 0`, `Community 60`, `Community 20`?**
  _High betweenness centrality (0.017) - this node is a cross-community bridge._
- **Why does `PolarProvider` connect `Community 25` to `Community 17`, `Community 1`?**
  _High betweenness centrality (0.012) - this node is a cross-community bridge._
- **Why does `ListenHub` connect `Community 57` to `Community 4`, `Community 1`?**
  _High betweenness centrality (0.010) - this node is a cross-community bridge._
- **What connects `OUTPUT`, `env`, `bool` to the rest of the system?**
  _438 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Community 0` be split into smaller, more focused modules?**
  _Cohesion score 0.0625694187338023 - nodes in this community are weakly interconnected._
- **Should `Community 1` be split into smaller, more focused modules?**
  _Cohesion score 0.07743271221532091 - nodes in this community are weakly interconnected._
- **Should `Community 2` be split into smaller, more focused modules?**
  _Cohesion score 0.06060606060606061 - nodes in this community are weakly interconnected._