// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Protocol limits and timings — the single source of truth.
 * The CLI mirrors these in Rust (`limits.rs`); `scripts/generate.ts` emits
 * `generated/limits.json` so a contract test can compare both sides.
 */
const KiB = 1024;
const MiB = 1024 * KiB;

export const Limits = {
	/** Largest stored (padded + encrypted) blob the API accepts. */
	blobMaxStoredBytes: MiB + 4 * KiB,
	/** Largest encrypted revision envelope. */
	envelopeMaxBytes: 512 * KiB,
	/** Most blobs a single revision may reference. */
	revisionMaxBlobs: 2000,
	/** Upper bound of Σ stored sizes per revision. */
	revisionMaxStoredBytes: 23 * MiB,
	/** Operations per commit request. */
	opsPerRequest: 50,
	/** IDs per `blobs/check` request. */
	blobCheckMax: 1000,
	/** Parts per batch upload / fetch request. */
	blobBatchMaxParts: 256,
	/** Body size of a batch upload request. */
	blobBatchMaxBytes: 8 * MiB,
	/** Longest long-poll wait in seconds. */
	longPollMaxWaitSeconds: 25,
	/** Largest page size for paginated lists. */
	pageMax: 200,
	/** Artifacts per snapshot page. */
	snapshotPage: 1000,
	/** Snapshot lease in seconds. */
	snapshotLeaseSeconds: 15 * 60,
	/** Roster statement (canonical JSON) size. */
	rosterStatementMaxBytes: 64 * KiB,
	/** Sealed key envelope / welcome size. */
	keyEnvelopeMaxBytes: 4 * KiB,
	welcomeMaxBytes: 256 * KiB,
	/** Encrypted binding payload size. */
	bindingPayloadMaxBytes: 16 * KiB,
	/** "Authorize CLI" request lifetime in seconds. */
	cliAuthTtlSeconds: 600,
	/** Unlock pepper releases per account. */
	pepperReleasesPerHour: 10,
	pepperReleasesPerDay: 30,
	/** How long a proven unlock secret lets this session fetch that member's envelopes. */
	unlockGrantSeconds: 600,
	/** WebAuthn challenge lifetime. */
	webauthnChallengeSeconds: 300,
	/** Consecutive wrong master passwords that notify other devices. */
	unlockFailedStreakAlert: 5,
	/** Trusted-browser window: default and allowed range in days. */
	browserTrustDaysDefault: 30,
	browserTrustDaysMin: 7,
	browserTrustDaysMax: 90,
	/** Access token lifetime in seconds. */
	accessTokenTtlSeconds: 300,
	/** Accepted DPoP `iat` skew in seconds. */
	dpopIatWindowSeconds: 60,
	/** DPoP nonce bucket length in seconds. */
	dpopNonceBucketSeconds: 300,
	/** Step-up freshness (fresh OAuth sign-in) in seconds. */
	stepUpMaxAgeSeconds: 600,
	/** Retention. */
	revisionRetentionDays: 30,
	eventRetentionDays: 90,
	receiptRetentionDays: 30,
	blobGcGraceHours: 24,
	pendingBlobTtlMinutes: 60,
	/** Pouch delete / account reset undo window. */
	undoWindowDays: 7,
} as const;

export type LimitName = keyof typeof Limits;
