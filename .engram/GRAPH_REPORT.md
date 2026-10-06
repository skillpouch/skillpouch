# Graph Report - .  (2026-10-06)

## Corpus Check
- 153 files · ~77,026 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 904 nodes · 2168 edges · 45 communities detected
- Extraction: 100% EXTRACTED · 0% INFERRED · 0% AMBIGUOUS
- Token cost: 0 input · 0 output
- Edge kinds: contains: 662 · imports: 565 · imports_from: 389 · MODIFIES: 224 · calls: 165 · method: 75 · references: 49 · ON_BRANCH: 15 · PARENT_OF: 14 · cites: 6 · implements: 2 · inherits: 2


## Input Scope
- Requested: auto
- Resolved: committed (source: default-auto)
- Included files: 153 · Candidates: 187
- Excluded: 0 untracked · 21775 ignored · 2 sensitive · 0 missing committed
- Recommendation: Use --scope all or graphify.yaml inputs.corpus for a knowledge-base folder.

## Graph Freshness
- Built from Git commit: `8c56203`
- Compare this hash to `git rev-parse HEAD` before trusting freshness-sensitive graph output.
## God Nodes (most connected - your core abstractions)
1. `Deps` - 37 edges
2. `AppError` - 35 edges
3. `withTenantTx()` - 22 edges
4. `ZodApp` - 21 edges
5. `principalOf()` - 15 edges
6. `storage_accounts` - 15 edges
7. `appendAudit()` - 13 edges
8. `audit()` - 12 edges
9. `TenantTx` - 12 edges
10. `CliClient` - 12 edges

## Surprising Connections (you probably didn't know these)
- `033ee44 chore: monorepo foundations and @skillpouch/contracts` --ON_BRANCH--> `main`  [EXTRACTED]
  git → git  _Bridges community 5 → community 0_
- `033ee44 chore: monorepo foundations and @skillpouch/contracts` --PARENT_OF--> `fc3acb0 feat(db): schema, RLS, migration runner and catalog tests`  [EXTRACTED]
  git → git  _Bridges community 5 → community 28_
- `41d7ef9 feat(api): sync protocol — blobs, commits, conflicts, events, snapshots, artifacts, bindings, checkpoints (+ integration tests)` --ON_BRANCH--> `main`  [EXTRACTED]
  git → git  _Bridges community 1 → community 0_
- `41d7ef9 feat(api): sync protocol — blobs, commits, conflicts, events, snapshots, artifacts, bindings, checkpoints (+ integration tests)` --PARENT_OF--> `f4707a7 feat(api): master-password/passkey/Recovery Key unlock, trusted browsers, roster invariants (+ tests)`  [EXTRACTED]
  git → git  _Bridges community 1 → community 5_
- `83cd94d chore(engram): refresh code graph` --PARENT_OF--> `8c56203 feat(api): committed OpenAPI spec for clients (pnpm openapi, CI drift check); Polar webhooks ordered by modified_at, revoke via ended_at, reconcile skips finished subscriptions; billing setup docs`  [EXTRACTED]
  git → git  _Bridges community 0 → community 10_

## Communities

### Community 0 - "Community 0"
Cohesion: 0.05
Nodes (44): Auth, AuthDeps, createAuth(), main, 4040b5c chore(engram): update code graph after backend milestone, 69e1c91 build(api): ship migrations inside the bundle; CI boots the worker and the env-free bundle, 83cd94d chore(engram): refresh code graph, 90143fd feat(deploy): deploy/secrets folder; production boot resolves secrets from /run/secrets and lists missing ones; init-secrets.sh; fixed container uid (+36 more)

### Community 1 - "Community 1"
Cohesion: 0.11
Nodes (16): UserDetail, UserParam, SubscriptionView, BlobParams, 41d7ef9 feat(api): sync protocol — blobs, commits, conflicts, events, snapshots, artifacts, bindings, checkpoints (+ integration tests), a1730a9 feat(api): server foundation, security core, roster, pouches, CLI authorize, devices, account, HealthState, paginated() (+8 more)

### Community 2 - "Community 2"
Cohesion: 0.08
Nodes (21): RevisionRow, formatRefreshToken(), issueDeviceTokens(), ParsedRefreshToken, parseRefreshToken(), refreshDeviceTokens(), Executor, notifyAccount() (+13 more)

### Community 3 - "Community 3"
Cohesion: 0.12
Nodes (18): c398dbc test(api): end-to-end journey over a real socket (SSE, long-poll, unlock, revoke, shutdown), BrowserClient, nonces, RequestOptions, signIn(), envelopesFor(), MemberHandle, memberJson() (+10 more)

### Community 4 - "Community 4"
Cohesion: 0.11
Nodes (26): audit(), clearOverride(), createPlan(), findUser(), grantPlan(), listUsers(), PlanInput, PlanRow (+18 more)

### Community 5 - "Community 5"
Cohesion: 0.08
Nodes (17): 033ee44 chore: monorepo foundations and @skillpouch/contracts, f4707a7 feat(api): master-password/passkey/Recovery Key unlock, trusted browsers, roster invariants (+ tests), ErrorCode, errorCodeList, ErrorDef, errorDocsUrl(), packageRoot, canonicalDigest() (+9 more)

### Community 6 - "Community 6"
Cohesion: 0.08
Nodes (33): RFC-7517, CliAuthApprove, CliAuthCreate, CliAuthCreated, CliAuthRequestView, CliAuthTokenRequest, CliAuthTokenResponse, DeviceTokens (+25 more)

### Community 7 - "Community 7"
Cohesion: 0.13
Nodes (35): account_members, account_unlock, accounts, artifacts, audit_log, billing_events, bindings, blobs (+27 more)

### Community 8 - "Community 8"
Cohesion: 0.15
Nodes (24): RFC-9562, SseFrame, ApiResponse, BaseClient, b64(), keyEnvelope(), newMember(), randomBlobId() (+16 more)

### Community 9 - "Community 9"
Cohesion: 0.09
Nodes (14): RequestRow, appendAudit(), AuditEntry, computeRowHash(), Executor, blake3Hash(), bytesEqualBuffers(), hashIp() (+6 more)

### Community 10 - "Community 10"
Cohesion: 0.12
Nodes (18): applyPendingBillingEvents(), applySubscription(), markBillingEventProcessed(), reconcileSubscriptions(), TERMINAL, BillingProvider, dateOrNull(), header() (+10 more)

### Community 11 - "Community 11"
Cohesion: 0.16
Nodes (21): gcBlobs(), gcPending(), expireBrowserTrust(), expireCliAuthRequests(), flagStaleDevices(), purgeEphemeral(), recalcUsage(), refreshAllEntitlements() (+13 more)

### Community 12 - "Community 12"
Cohesion: 0.07
Nodes (27): AccountEventType, Artifact, ArtifactListQuery, Binding, BindingsPut, BlobBatchResponse, BlobCheckRequest, BlobCheckResponse (+19 more)

### Community 13 - "Community 13"
Cohesion: 0.12
Nodes (19): RFC-7638, authenticateDevice(), authenticateSession(), browserTrustDays(), clientIpHash(), EXEMPT_PREFIXES, isStepUpFresh(), lastSeenWrites (+11 more)

### Community 14 - "Community 14"
Cohesion: 0.14
Nodes (7): assertValidKey(), BlobKey, BlobStore, BlobStore, FsBlobStore, fsyncDir(), TenantBlobStore

### Community 15 - "Community 15"
Cohesion: 0.09
Nodes (22): KeyEnvelope, MemberKind, RosterStatementInput, BrowserEnrollRequest, KdfParams, MasterPasswordChange, PasskeyAssertRequest, PasskeyAssertResponse (+14 more)

### Community 16 - "Community 16"
Cohesion: 0.09
Nodes (7): concatBytes(), revisionSignedMessage(), verifyMemberSignature(), commitPendingUnlock(), DEFAULT_KDF_PARAMS, lockUnlockRow(), ROSTER_FOLLOW_UPS

### Community 17 - "Community 17"
Cohesion: 0.17
Nodes (15): applyOne(), applyWithRetry(), loadMigrations(), migrate(), MigrateOptions, MigrationFile, MIGRATIONS_DIR, adminQuery() (+7 more)

### Community 18 - "Community 18"
Cohesion: 0.21
Nodes (11): openEventStream(), parseCursors(), deviceOf(), memberOf(), principalOf(), sessionOf(), GENERIC_APPEND_ACTIONS, DevicePrincipal (+3 more)

### Community 19 - "Community 19"
Cohesion: 0.14
Nodes (14): AppError, isAppError(), errorBody(), sendError(), toAppError(), NEXT_CURSOR, ImportKind, INSTRUCTION_FILES (+6 more)

### Community 20 - "Community 20"
Cohesion: 0.17
Nodes (13): AppendContext, AppendResult, appendStatements(), applyEffect(), assertEnvelopeCoverage(), assertMembershipInvariants(), insertKeyEnvelopes(), insertMember() (+5 more)

### Community 21 - "Community 21"
Cohesion: 0.16
Nodes (12): applyPouchLimit(), PlanRow, refreshEntitlementsInTx(), toLimits(), GrantInput, isSubscriptionEntitled(), outranks(), OverrideInput (+4 more)

### Community 22 - "Community 22"
Cohesion: 0.12
Nodes (16): Entitlements, AdminGrantPlan, AdminOverview, AdminPlan, AdminPlanInput, AdminReason, AdminSetOverride, AdminSetRole (+8 more)

### Community 23 - "Community 23"
Cohesion: 0.12
Nodes (16): ActivePouchReport, BrowserMember, ClientSecurityReport, CliLatest, CursorReport, Device, DeviceList, MeResponse (+8 more)

### Community 24 - "Community 24"
Cohesion: 0.13
Nodes (6): AccountNotification, CHANNELS, DeviceRevokedNotification, ListenHub, Logger, PouchNotification

### Community 25 - "Community 25"
Cohesion: 0.17
Nodes (13): bytea, tenantColumn(), tstz(), cliAuthRequests, CliAuthState, deviceKeys, devices, DeviceState (+5 more)

### Community 26 - "Community 26"
Cohesion: 0.13
Nodes (14): artifacts, bindings, blobs, checkpoints, conflicts, ConflictType, deviceCursors, events (+6 more)

### Community 27 - "Community 27"
Cohesion: 0.15
Nodes (12): billingEvents, entitlementOverrides, EntitlementsJson, planGrants, plans, storageAccounts, subscriptions, accounts (+4 more)

### Community 28 - "Community 28"
Cohesion: 0.19
Nodes (5): fc3acb0 feat(db): schema, RLS, migration runner and catalog tests, createPool(), Database, DbRole, PoolOptions

### Community 29 - "Community 29"
Cohesion: 0.22
Nodes (5): RFC-3339, addSeconds(), findPouch(), findWritablePouch(), PouchRow

### Community 30 - "Community 30"
Cohesion: 0.20
Nodes (9): AuthMode, fastify, FastifyContextConfig, FastifyRequest, RateLimitBucket, SkillpouchRouteConfig, BucketPolicy, BUCKETS (+1 more)

### Community 31 - "Community 31"
Cohesion: 0.18
Nodes (10): accountMembers, accountUnlock, KdfParams, keyEnvelopes, MEMBER_KINDS, MemberKind, passkeyUnlockers, rosterStatements (+2 more)

### Community 32 - "Community 32"
Cohesion: 0.42
Nodes (3): b64(), sha256(), SoftAuthenticator

### Community 33 - "Community 33"
Cohesion: 0.25
Nodes (8): applied(), applyOperation(), insertRevision(), liveArtifactWithName(), notPinnedByConflict(), OperationRejected, recordConflict(), validate()

### Community 34 - "Community 34"
Cohesion: 0.32
Nodes (3): blobIdBytes(), getBlob(), putBlob()

### Community 35 - "Community 35"
Cohesion: 0.29
Nodes (3): RFC-9449, PublicJwk, TestKey

### Community 36 - "Community 36"
Cohesion: 0.32
Nodes (4): basename(), detectItems(), dirname(), GithubImporter

### Community 37 - "Community 37"
Cohesion: 0.33
Nodes (7): cancelCliAuthRequest(), finishRedeem(), getCliAuthRequest(), isExpired(), loadRequest(), redeemCliAuthRequest(), requestView()

### Community 38 - "Community 38"
Cohesion: 0.38
Nodes (1): SseConnection

### Community 39 - "Community 39"
Cohesion: 0.40
Nodes (1): DeviceStatusCache

### Community 40 - "Community 40"
Cohesion: 0.60
Nodes (1): NonceService

### Community 41 - "Community 41"
Cohesion: 0.47
Nodes (2): aad(), PepperBox

### Community 42 - "Community 42"
Cohesion: 0.40
Nodes (1): NewEvent

### Community 43 - "Community 43"
Cohesion: 0.40
Nodes (1): CliClient

### Community 44 - "Community 44"
Cohesion: 1.00
Nodes (3): overSocket(), parse(), request()

## Knowledge Gaps
- **248 isolated node(s):** `OUTPUT`, `env`, `bool`, `EnvSchema`, `SECRET_KEYS` (+243 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **Thin community `Community 38`** (1 nodes): `SseConnection`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 39`** (1 nodes): `DeviceStatusCache`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 40`** (1 nodes): `NonceService`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 41`** (2 nodes): `aad()`, `PepperBox`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 42`** (1 nodes): `NewEvent`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 43`** (1 nodes): `CliClient`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `AppError` connect `Community 19` to `Community 18`, `Community 8`, `Community 4`, `Community 1`, `Community 10`, `Community 34`, `Community 9`, `Community 2`, `Community 21`, `Community 29`, `Community 20`, `Community 13`, `Community 16`?**
  _High betweenness centrality (0.025) - this node is a cross-community bridge._
- **Why does `ListenHub` connect `Community 24` to `Community 1`?**
  _High betweenness centrality (0.020) - this node is a cross-community bridge._
- **Why does `Deps` connect `Community 1` to `Community 18`, `Community 4`, `Community 10`, `Community 34`, `Community 9`, `Community 2`, `Community 3`, `Community 11`, `Community 13`, `Community 0`, `Community 16`?**
  _High betweenness centrality (0.020) - this node is a cross-community bridge._
- **What connects `OUTPUT`, `env`, `bool` to the rest of the system?**
  _248 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Community 0` be split into smaller, more focused modules?**
  _Cohesion score 0.05268065268065268 - nodes in this community are weakly interconnected._
- **Should `Community 1` be split into smaller, more focused modules?**
  _Cohesion score 0.10638297872340426 - nodes in this community are weakly interconnected._
- **Should `Community 2` be split into smaller, more focused modules?**
  _Cohesion score 0.0796221322537112 - nodes in this community are weakly interconnected._