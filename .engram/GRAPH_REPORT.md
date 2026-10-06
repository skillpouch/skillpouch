# Graph Report - .  (2026-10-06)

## Corpus Check
- 118 files · ~56,492 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 733 nodes · 1660 edges · 43 communities detected
- Extraction: 100% EXTRACTED · 0% INFERRED · 0% AMBIGUOUS
- Token cost: 0 input · 0 output
- Edge kinds: contains: 550 · imports: 414 · imports_from: 299 · MODIFIES: 174 · calls: 101 · method: 55 · references: 49 · cites: 6 · ON_BRANCH: 5 · PARENT_OF: 4 · inherits: 2 · implements: 1


## Input Scope
- Requested: auto
- Resolved: committed (source: default-auto)
- Included files: 118 · Candidates: 138
- Excluded: 0 untracked · 21571 ignored · 1 sensitive · 0 missing committed
- Recommendation: Use --scope all or graphify.yaml inputs.corpus for a knowledge-base folder.

## Graph Freshness
- Built from Git commit: `f4707a7`
- Compare this hash to `git rev-parse HEAD` before trusting freshness-sensitive graph output.
## God Nodes (most connected - your core abstractions)
1. `AppError` - 30 edges
2. `Deps` - 26 edges
3. `withTenantTx()` - 19 edges
4. `ZodApp` - 18 edges
5. `storage_accounts` - 15 edges
6. `principalOf()` - 14 edges
7. `TenantTx` - 12 edges
8. `pouches` - 12 edges
9. `FsBlobStore` - 11 edges
10. `ListenHub` - 11 edges

## Surprising Connections (you probably didn't know these)
- `033ee44 chore: monorepo foundations and @skillpouch/contracts` --ON_BRANCH--> `main`  [EXTRACTED]
  git → git  _Bridges community 4 → community 14_
- `033ee44 chore: monorepo foundations and @skillpouch/contracts` --PARENT_OF--> `fc3acb0 feat(db): schema, RLS, migration runner and catalog tests`  [EXTRACTED]
  git → git  _Bridges community 4 → community 24_
- `41d7ef9 feat(api): sync protocol — blobs, commits, conflicts, events, snapshots, artifacts, bindings, checkpoints (+ integration tests)` --ON_BRANCH--> `main`  [EXTRACTED]
  git → git  _Bridges community 5 → community 14_
- `fc3acb0 feat(db): schema, RLS, migration runner and catalog tests` --ON_BRANCH--> `main`  [EXTRACTED]
  git → git  _Bridges community 24 → community 14_
- `sessionOf()` --calls--> `principalOf()`  [EXTRACTED]
  apps/api/src/http/principal.ts → apps/api/src/http/principal.ts  _Bridges community 6 → community 2_

## Communities

### Community 0 - "Community 0"
Cohesion: 0.08
Nodes (33): RFC-7517, CliAuthApprove, CliAuthCreate, CliAuthCreated, CliAuthRequestView, CliAuthTokenRequest, CliAuthTokenResponse, DeviceTokens (+25 more)

### Community 1 - "Community 1"
Cohesion: 0.13
Nodes (35): account_members, account_unlock, accounts, artifacts, audit_log, billing_events, bindings, blobs (+27 more)

### Community 2 - "Community 2"
Cohesion: 0.14
Nodes (11): BlobParams, deviceOf(), memberOf(), principalOf(), ZodApp, notifyPouch(), clientIpHash(), touchDevice() (+3 more)

### Community 3 - "Community 3"
Cohesion: 0.10
Nodes (10): assertValidKey(), BlobKey, BlobStore, BlobStore, FsBlobStore, fsyncDir(), TenantBlobStore, blobIdBytes() (+2 more)

### Community 4 - "Community 4"
Cohesion: 0.10
Nodes (16): 033ee44 chore: monorepo foundations and @skillpouch/contracts, ErrorCode, errorCodeList, ErrorDef, errorDocsUrl(), packageRoot, canonicalDigest(), canonicalJson() (+8 more)

### Community 5 - "Community 5"
Cohesion: 0.12
Nodes (19): 41d7ef9 feat(api): sync protocol — blobs, commits, conflicts, events, snapshots, artifacts, bindings, checkpoints (+ integration tests), RFC-7638, AppError, authenticateDevice(), authenticateSession(), browserTrustDays(), EXEMPT_PREFIXES, lastSeenWrites (+11 more)

### Community 6 - "Community 6"
Cohesion: 0.10
Nodes (12): RFC-3339, sessionOf(), addSeconds(), GENERIC_APPEND_ACTIONS, appendAudit(), AuditEntry, computeRowHash(), Executor (+4 more)

### Community 7 - "Community 7"
Cohesion: 0.07
Nodes (27): AccountEventType, Artifact, ArtifactListQuery, Binding, BindingsPut, BlobBatchResponse, BlobCheckRequest, BlobCheckResponse (+19 more)

### Community 8 - "Community 8"
Cohesion: 0.13
Nodes (17): HealthState, isAppError(), envelopePlugin, errorBody(), sendError(), toAppError(), envelopeJsonSchemaTransform(), envelopeSerializerCompiler() (+9 more)

### Community 9 - "Community 9"
Cohesion: 0.09
Nodes (22): KeyEnvelope, MemberKind, RosterStatementInput, BrowserEnrollRequest, KdfParams, MasterPasswordChange, PasskeyAssertRequest, PasskeyAssertResponse (+14 more)

### Community 10 - "Community 10"
Cohesion: 0.09
Nodes (7): concatBytes(), revisionSignedMessage(), verifyMemberSignature(), commitPendingUnlock(), DEFAULT_KDF_PARAMS, lockUnlockRow(), ROSTER_FOLLOW_UPS

### Community 11 - "Community 11"
Cohesion: 0.13
Nodes (13): RequestRow, ArtifactRow, CommitContext, CommitInput, EVENT_FOR, blake3Hash(), bytesEqualBuffers(), hashIp() (+5 more)

### Community 12 - "Community 12"
Cohesion: 0.17
Nodes (13): MemberHandle, memberJson(), RosterHead, Account, accountIdOf(), authorizeCli(), setupAccount(), createHarness() (+5 more)

### Community 13 - "Community 13"
Cohesion: 0.18
Nodes (15): applyOne(), applyWithRetry(), loadMigrations(), migrate(), MigrateOptions, MigrationFile, MIGRATIONS_DIR, adminQuery() (+7 more)

### Community 14 - "Community 14"
Cohesion: 0.13
Nodes (14): Auth, AuthDeps, createAuth(), main, a1730a9 feat(api): server foundation, security core, roster, pouches, CLI authorize, devices, account, f4707a7 feat(api): master-password/passkey/Recovery Key unlock, trusted browsers, roster invariants (+ tests), bool, Env (+6 more)

### Community 15 - "Community 15"
Cohesion: 0.13
Nodes (9): ApiResponse, BaseClient, BrowserClient, CliClient, nonces, parse(), request(), RequestOptions (+1 more)

### Community 16 - "Community 16"
Cohesion: 0.17
Nodes (13): AppendContext, AppendResult, appendStatements(), applyEffect(), assertEnvelopeCoverage(), assertMembershipInvariants(), insertKeyEnvelopes(), insertMember() (+5 more)

### Community 17 - "Community 17"
Cohesion: 0.22
Nodes (14): RFC-9562, sealed(), buildOp(), commit(), commitOne(), nameIndex(), OpInput, OpType (+6 more)

### Community 18 - "Community 18"
Cohesion: 0.12
Nodes (16): Entitlements, AdminGrantPlan, AdminOverview, AdminPlan, AdminPlanInput, AdminReason, AdminSetOverride, AdminSetRole (+8 more)

### Community 19 - "Community 19"
Cohesion: 0.12
Nodes (16): ActivePouchReport, BrowserMember, ClientSecurityReport, CliLatest, CursorReport, Device, DeviceList, MeResponse (+8 more)

### Community 20 - "Community 20"
Cohesion: 0.13
Nodes (6): AccountNotification, CHANNELS, DeviceRevokedNotification, ListenHub, Logger, PouchNotification

### Community 21 - "Community 21"
Cohesion: 0.17
Nodes (13): bytea, tenantColumn(), tstz(), cliAuthRequests, CliAuthState, deviceKeys, devices, DeviceState (+5 more)

### Community 22 - "Community 22"
Cohesion: 0.22
Nodes (8): decodeCursor(), encodeCursor(), paginated(), DeviceStatus, RETRYABLE_SQLSTATES, TenantTxOptions, Transaction, withTenantTx()

### Community 23 - "Community 23"
Cohesion: 0.13
Nodes (14): artifacts, bindings, blobs, checkpoints, conflicts, ConflictType, deviceCursors, events (+6 more)

### Community 24 - "Community 24"
Cohesion: 0.18
Nodes (5): fc3acb0 feat(db): schema, RLS, migration runner and catalog tests, createPool(), Database, DbRole, PoolOptions

### Community 25 - "Community 25"
Cohesion: 0.19
Nodes (8): formatRefreshToken(), issueDeviceTokens(), ParsedRefreshToken, parseRefreshToken(), refreshDeviceTokens(), Executor, notifyAccount(), notifyDeviceRevoked()

### Community 26 - "Community 26"
Cohesion: 0.15
Nodes (12): billingEvents, entitlementOverrides, EntitlementsJson, planGrants, plans, storageAccounts, subscriptions, accounts (+4 more)

### Community 27 - "Community 27"
Cohesion: 0.27
Nodes (9): RFC-9449, b64(), envelopesFor(), keyEnvelope(), newMember(), randomBlobId(), SECRET_KINDS, statement() (+1 more)

### Community 28 - "Community 28"
Cohesion: 0.20
Nodes (9): AuthMode, fastify, FastifyContextConfig, FastifyRequest, RateLimitBucket, SkillpouchRouteConfig, BucketPolicy, BUCKETS (+1 more)

### Community 29 - "Community 29"
Cohesion: 0.18
Nodes (10): accountMembers, accountUnlock, KdfParams, keyEnvelopes, MEMBER_KINDS, MemberKind, passkeyUnlockers, rosterStatements (+2 more)

### Community 30 - "Community 30"
Cohesion: 0.20
Nodes (3): RevisionRow, NewEvent, TenantTx

### Community 31 - "Community 31"
Cohesion: 0.33
Nodes (6): openEventStream(), openStreams, parseCursors(), DevicePrincipal, Principal, SessionPrincipal

### Community 32 - "Community 32"
Cohesion: 0.28
Nodes (8): GrantInput, isSubscriptionEntitled(), outranks(), OverrideInput, PlanLimits, resolveEntitlements(), ResolveInput, SubscriptionInput

### Community 33 - "Community 33"
Cohesion: 0.42
Nodes (3): b64(), sha256(), SoftAuthenticator

### Community 34 - "Community 34"
Cohesion: 0.25
Nodes (8): applied(), applyOperation(), insertRevision(), liveArtifactWithName(), notPinnedByConflict(), OperationRejected, recordConflict(), validate()

### Community 35 - "Community 35"
Cohesion: 0.32
Nodes (4): applyPouchLimit(), PlanRow, refreshEntitlementsInTx(), toLimits()

### Community 36 - "Community 36"
Cohesion: 0.33
Nodes (7): cancelCliAuthRequest(), finishRedeem(), getCliAuthRequest(), isExpired(), loadRequest(), redeemCliAuthRequest(), requestView()

### Community 37 - "Community 37"
Cohesion: 0.33
Nodes (3): findPouch(), findWritablePouch(), PouchRow

### Community 38 - "Community 38"
Cohesion: 0.60
Nodes (1): NonceService

### Community 39 - "Community 39"
Cohesion: 0.47
Nodes (2): aad(), PepperBox

### Community 40 - "Community 40"
Cohesion: 0.50
Nodes (1): TestKey

### Community 41 - "Community 41"
Cohesion: 0.40
Nodes (1): SettingsCache

### Community 42 - "Community 42"
Cohesion: 0.50
Nodes (1): DeviceStatusCache

## Knowledge Gaps
- **224 isolated node(s):** `bool`, `EnvSchema`, `SECRET_KEYS`, `AuthMode`, `SkillpouchRouteConfig` (+219 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **Thin community `Community 38`** (1 nodes): `NonceService`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 39`** (2 nodes): `aad()`, `PepperBox`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 40`** (1 nodes): `TestKey`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 41`** (1 nodes): `SettingsCache`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 42`** (1 nodes): `DeviceStatusCache`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `ListenHub` connect `Community 20` to `Community 2`?**
  _High betweenness centrality (0.024) - this node is a cross-community bridge._
- **Why does `FsBlobStore` connect `Community 3` to `Community 2`?**
  _High betweenness centrality (0.024) - this node is a cross-community bridge._
- **Why does `AppError` connect `Community 5` to `Community 6`, `Community 14`, `Community 22`, `Community 2`, `Community 3`, `Community 11`, `Community 25`, `Community 35`, `Community 31`, `Community 8`, `Community 37`, `Community 16`, `Community 10`?**
  _High betweenness centrality (0.014) - this node is a cross-community bridge._
- **What connects `bool`, `EnvSchema`, `SECRET_KEYS` to the rest of the system?**
  _224 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Community 0` be split into smaller, more focused modules?**
  _Cohesion score 0.08408408408408409 - nodes in this community are weakly interconnected._
- **Should `Community 1` be split into smaller, more focused modules?**
  _Cohesion score 0.13333333333333333 - nodes in this community are weakly interconnected._
- **Should `Community 2` be split into smaller, more focused modules?**
  _Cohesion score 0.13911290322580644 - nodes in this community are weakly interconnected._