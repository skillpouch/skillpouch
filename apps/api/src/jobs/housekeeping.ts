// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Small periodic jobs: expiring login requests and browser
 * trust, purging short-lived security tables, usage drift checks, blob
 * integrity sampling and the nightly entitlement refresh.
 */
import { Limits, toHex } from '@skillpouch/contracts';
import { sql } from 'drizzle-orm';
import type { Deps } from '../deps';
import { blake3Hash } from '../security/crypto-util';
import { refreshEntitlements } from '../modules/entitlements/entitlements.service';
import { rows } from './sql';

/**
 * `cli-auth.expire`: open requests past their TTL expire; final ones are
 * deleted after 24 h, and so are connect tokens past their lifetime.
 */
export async function expireCliAuthRequests(
	deps: Deps,
): Promise<{ expired: number; deleted: number; tokens: number }> {
	const expired = await deps.db.maintenance.execute(sql`
		UPDATE cli_auth_requests SET state = 'expired', finalized_at = now()
		WHERE state IN ('open', 'approved') AND expires_at < now()`);
	const deleted = await deps.db.maintenance.execute(sql`
		DELETE FROM cli_auth_requests
		WHERE state <> 'open' AND COALESCE(finalized_at, expires_at) < now() - interval '24 hours'`);
	const tokens = await deps.db.maintenance.execute(sql`
		DELETE FROM cli_connect_tokens WHERE expires_at < now() - interval '24 hours'`);
	return {
		expired: expired.rowCount ?? 0,
		deleted: deleted.rowCount ?? 0,
		tokens: tokens.rowCount ?? 0,
	};
}

/**
 * `browsers.trust-expire`: browser members unused longer than their account's
 * trust window (default 30 days, 7–90) stop receiving key envelopes.
 * The request path enforces the same rule; this job makes it visible on the
 * Devices page even for browsers that never come back.
 */
export async function expireBrowserTrust(deps: Deps): Promise<number> {
	const result = await deps.db.maintenance.execute(sql`
		UPDATE account_members m SET trust_expired_at = now()
		FROM storage_accounts sa
		WHERE sa.id = m.storage_account_id
			AND m.kind = 'browser' AND m.removed_seq IS NULL AND m.revoked_at IS NULL
			AND m.trust_expired_at IS NULL
			AND COALESCE(m.last_seen_at, m.created_at) < now() - make_interval(days =>
				LEAST(${Limits.browserTrustDaysMax}, GREATEST(${Limits.browserTrustDaysMin},
					COALESCE((sa.security_settings->>'browser_trust_days')::int, ${Limits.browserTrustDaysDefault}))))`);
	return result.rowCount ?? 0;
}

/** Purges expired rows of short-lived tables (DPoP replay cache, challenges, grants, …). */
export async function purgeEphemeral(deps: Deps): Promise<number> {
	let total = 0;
	for (const query of [
		sql`DELETE FROM dpop_replay WHERE expires_at < now()`,
		sql`DELETE FROM webauthn_challenges WHERE expires_at < now()`,
		sql`DELETE FROM unlock_grants WHERE expires_at < now()`,
		sql`DELETE FROM snapshots WHERE expires_at < now()`,
		sql`DELETE FROM rate_limits WHERE refilled_at < now() - interval '1 day'`,
	]) {
		total += (await deps.db.maintenance.execute(query)).rowCount ?? 0;
	}
	return total;
}

/** `devices.stale`: one informational security event per device unseen for 90 days. */
export async function flagStaleDevices(deps: Deps): Promise<number> {
	const result = await deps.db.maintenance.execute(sql`
		INSERT INTO security_events (storage_account_id, kind, severity, details)
		SELECT d.storage_account_id, 'device.stale', 'info', jsonb_build_object('device_id', d.id, 'name', d.name)
		FROM devices d
		WHERE d.state = 'active' AND COALESCE(d.last_seen_at, d.created_at) < now() - interval '90 days'
			AND NOT EXISTS (
				SELECT 1 FROM security_events e
				WHERE e.storage_account_id = d.storage_account_id AND e.kind = 'device.stale'
					AND e.details->>'device_id' = d.id::text
			)`);
	return result.rowCount ?? 0;
}

/**
 * `usage.recalc`: recomputes used/pending bytes from what is stored and
 * logs drift (a bug signal — counters are maintained transactionally).
 */
export async function recalcUsage(deps: Deps): Promise<number> {
	const drifted = rows<{ id: string; before: number; after: number }>(
		await deps.db.maintenance.execute(sql`
			WITH actual AS (
				SELECT sa.id,
					COALESCE((SELECT sum(stored_size) FROM blobs b WHERE b.storage_account_id = sa.id AND b.state = 'stored'), 0)
					+ COALESCE((SELECT sum(octet_length(envelope)) FROM revisions r WHERE r.storage_account_id = sa.id), 0) AS used,
					COALESCE((SELECT sum(stored_size) FROM blobs b WHERE b.storage_account_id = sa.id AND b.state = 'pending'), 0) AS pending
				FROM storage_accounts sa
			), changed AS (
				UPDATE storage_accounts sa SET used_bytes = actual.used, pending_bytes = actual.pending
				FROM actual
				WHERE sa.id = actual.id AND (sa.used_bytes <> actual.used OR sa.pending_bytes <> actual.pending)
				RETURNING sa.id, actual.used AS after
			)
			SELECT id, after, after AS before FROM changed`),
	);
	if (drifted.length > 0) deps.log.warn({ accounts: drifted.length }, 'usage drift corrected');
	return drifted.length;
}

/**
 * `blobs.verify`: re-hashes a ~1 % sample of stored ciphertext against
 * `ciphertext_hash` (bit rot, tampering, broken disks). Mismatches become
 * critical security events for the account and an error log line.
 */
export async function verifyBlobSample(
	deps: Deps,
	fraction = 0.01,
	limit = 500,
): Promise<{ checked: number; bad: number }> {
	const sample = rows<{
		storage_account_id: string;
		pouch_id: string;
		blob_id: Buffer;
		ciphertext_hash: Buffer;
	}>(
		await deps.db.maintenance.execute(sql`
			SELECT storage_account_id, pouch_id, blob_id, ciphertext_hash FROM blobs
			WHERE state = 'stored' AND ciphertext_hash IS NOT NULL AND random() < ${fraction}
			LIMIT ${limit}`),
	);
	let bad = 0;
	for (const blob of sample) {
		const bytes = await deps.blobs.get({
			storageAccountId: blob.storage_account_id,
			pouchId: blob.pouch_id,
			blobIdHex: toHex(blob.blob_id),
		});
		if (bytes && blake3Hash(bytes).equals(blob.ciphertext_hash)) continue;
		bad += 1;
		deps.log.error(
			{ pouch: blob.pouch_id, missing: bytes === null },
			'blob verification failed',
		);
		await deps.db.maintenance.execute(sql`
			INSERT INTO security_events (storage_account_id, kind, severity, details)
			VALUES (${blob.storage_account_id}::uuid, 'blob.corrupt', 'critical',
				jsonb_build_object('pouch_id', ${blob.pouch_id}::text, 'missing', ${bytes === null}::boolean))`);
	}
	return { checked: sample.length, bad };
}

/** `entitlements.refresh` (nightly): recompute every account's effective limits. */
export async function refreshAllEntitlements(deps: Deps): Promise<number> {
	const accounts = rows<{ id: string }>(
		await deps.db.maintenance.execute(sql`SELECT id FROM storage_accounts`),
	);
	for (const account of accounts) await refreshEntitlements(deps.db.app, account.id);
	return accounts.length;
}
