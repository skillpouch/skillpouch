// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Storage usage and "Free up space".
 *
 * The server cannot see names or content (E2EE), so it reports sizes per
 * opaque artifact ID and the browser joins them with the names it decrypts.
 * The server never chooses what to delete: items are removed by signed
 * `delete` operations from the browser, and this module only frees the bytes
 * their older versions and deleted items still hold — immediately, instead of
 * after the 30-day retention window or the 7 days in the trash.
 */
import { Limits, toHex } from '@skillpouch/contracts';
import { artifacts, storageAccounts } from '@skillpouch/db';
import { and, eq, inArray, sql } from 'drizzle-orm';
import type { Deps } from '../../deps';
import { AppError } from '../../http/app-error';
import { recalcAccountUsage } from '../../jobs/purge';
import { releaseRevisions, releaseTombstoneFiles } from '../../jobs/retention';
import { rows } from '../../jobs/sql';
import { appendAudit } from '../../security/audit';
import { withTenantTx, type TenantTx } from '../../security/tenant-tx';
import { findPouch } from '../pouches/pouches.service';

interface PouchUsageRow {
	id: string;
	state: 'active' | 'locked' | 'archived' | 'deleted';
	bytes: number;
	history_bytes: number;
}

interface ArtifactUsageRow {
	id: string;
	pouch_id: string;
	deleted: boolean;
	head_bytes: number;
	history_bytes: number;
	updated_at: Date;
}

/** Sizes per pouch and per artifact for the caller's account (RLS-scoped). */
export async function storageUsage(tx: TenantTx, storageAccountId: string) {
	const [account] = await tx
		.select({
			used: storageAccounts.usedBytes,
			quota: storageAccounts.quotaBytes,
			overQuotaSince: storageAccounts.overQuotaSince,
			entitlements: storageAccounts.entitlements,
		})
		.from(storageAccounts)
		.where(eq(storageAccounts.id, storageAccountId));
	if (!account) throw new AppError('not_found');

	// A revision is "kept" by "Free up space" when it is a head or an open conflict
	// pins it; everything else is history. Both queries aggregate in one pass
	// (no per-row subqueries), so a pouch with thousands of items stays fast.
	const pouchRows = rows<PouchUsageRow>(
		await tx.execute(sql`
			WITH kept AS (
				SELECT head_revision_id AS id FROM artifacts WHERE head_revision_id IS NOT NULL
				UNION
				SELECT unnest(ARRAY[base_revision_id, server_revision_id, incoming_revision_id])
				FROM conflicts WHERE state = 'open'
			), kept_blobs AS (
				SELECT DISTINCT rb.pouch_id, rb.blob_id
				FROM revision_blobs rb JOIN kept ON kept.id = rb.revision_id
			), blob_totals AS (
				SELECT b.pouch_id, sum(b.stored_size) AS bytes,
					sum(b.stored_size) FILTER (WHERE k.blob_id IS NULL) AS history
				FROM blobs b
				LEFT JOIN kept_blobs k ON k.pouch_id = b.pouch_id AND k.blob_id = b.blob_id
				WHERE b.state = 'stored'
				GROUP BY b.pouch_id
			), revision_totals AS (
				SELECT r.pouch_id, sum(octet_length(r.envelope)) AS bytes,
					sum(octet_length(r.envelope)) FILTER (WHERE kept.id IS NULL) AS history
				FROM revisions r
				LEFT JOIN kept ON kept.id = r.id
				GROUP BY r.pouch_id
			)
			SELECT p.id, p.state,
				(COALESCE(bt.bytes, 0) + COALESCE(rt.bytes, 0))::bigint AS bytes,
				(COALESCE(bt.history, 0) + COALESCE(rt.history, 0))::bigint AS history_bytes
			FROM pouches p
			LEFT JOIN blob_totals bt ON bt.pouch_id = p.id
			LEFT JOIN revision_totals rt ON rt.pouch_id = p.id
			ORDER BY p.created_at, p.id`),
	);

	// Per item: the head version's bytes, and what only older versions hold
	// (their envelopes plus blobs the head no longer references).
	const artifactRows = rows<ArtifactUsageRow>(
		await tx.execute(sql`
			WITH head_blobs AS NOT MATERIALIZED (
				SELECT DISTINCT a.id AS artifact_id, rb.storage_account_id, rb.pouch_id, rb.blob_id
				FROM artifacts a JOIN revision_blobs rb ON rb.revision_id = a.head_revision_id
			), old_revisions AS NOT MATERIALIZED (
				SELECT r.id, r.artifact_id, octet_length(r.envelope) AS envelope_bytes
				FROM revisions r JOIN artifacts a ON a.id = r.artifact_id
				WHERE r.id IS DISTINCT FROM a.head_revision_id
			), old_blobs AS (
				SELECT DISTINCT o.artifact_id, rb.storage_account_id, rb.pouch_id, rb.blob_id
				FROM old_revisions o JOIN revision_blobs rb ON rb.revision_id = o.id
			), head_bytes AS (
				SELECT h.artifact_id, sum(b.stored_size) AS bytes
				FROM head_blobs h
				JOIN blobs b ON b.storage_account_id = h.storage_account_id
					AND b.pouch_id = h.pouch_id AND b.blob_id = h.blob_id
				GROUP BY h.artifact_id
			), history_blob_bytes AS (
				SELECT o.artifact_id, sum(b.stored_size) AS bytes
				FROM old_blobs o
				JOIN blobs b ON b.storage_account_id = o.storage_account_id
					AND b.pouch_id = o.pouch_id AND b.blob_id = o.blob_id
				WHERE NOT EXISTS (
					SELECT 1 FROM head_blobs h
					WHERE h.artifact_id = o.artifact_id AND h.pouch_id = o.pouch_id AND h.blob_id = o.blob_id
				)
				GROUP BY o.artifact_id
			), history_envelope_bytes AS (
				SELECT artifact_id, sum(envelope_bytes) AS bytes FROM old_revisions GROUP BY artifact_id
			)
			SELECT a.id, a.pouch_id, a.deleted_at IS NOT NULL AS deleted, a.updated_at,
				(COALESCE(octet_length(head.envelope), 0) + COALESCE(hb.bytes, 0))::bigint AS head_bytes,
				(COALESCE(he.bytes, 0) + COALESCE(hbb.bytes, 0))::bigint AS history_bytes
			FROM artifacts a
			LEFT JOIN revisions head ON head.id = a.head_revision_id
			LEFT JOIN head_bytes hb ON hb.artifact_id = a.id
			LEFT JOIN history_envelope_bytes he ON he.artifact_id = a.id
			LEFT JOIN history_blob_bytes hbb ON hbb.artifact_id = a.id
			ORDER BY a.pouch_id, a.id`),
	);

	const byPouch = new Map<string, ArtifactUsageRow[]>();
	for (const row of artifactRows) {
		const list = byPouch.get(row.pouch_id) ?? [];
		list.push(row);
		byPouch.set(row.pouch_id, list);
	}

	return {
		used_bytes: account.used,
		quota_bytes: account.quota,
		over_quota_since: account.overQuotaSince?.toISOString() ?? null,
		pouch_limit: account.entitlements.pouch_limit,
		pouches: pouchRows.map((pouch) => ({
			id: pouch.id,
			state: pouch.state,
			bytes: Number(pouch.bytes),
			history_bytes: Number(pouch.history_bytes),
			artifacts: (byPouch.get(pouch.id) ?? []).map((artifact) => ({
				id: artifact.id,
				deleted: artifact.deleted,
				head_bytes: Number(artifact.head_bytes),
				history_bytes: Number(artifact.history_bytes),
				updated_at: new Date(artifact.updated_at).toISOString(),
			})),
		})),
	};
}

/**
 * Removes older versions now. Without `artifactIds`: every non-current
 * revision of the pouch and the files of its deleted items (history +
 * trash). With them: the same for those artifacts, which must already be
 * deleted. A deleted item's head revision — its signed delete — always stays,
 * so a computer that syncs much later still removes its copy instead of
 * sending it back. Revisions an open conflict pins are always kept. Blobs
 * nothing references any more are deleted right away (no 24 h grace — the
 * user asked for the space back).
 */
export async function freeSpace(
	deps: Deps,
	input: {
		storageAccountId: string;
		pouchId: string;
		artifactIds?: string[] | undefined;
		actor: string;
	},
) {
	// Ownership and preconditions under RLS first; the purge itself runs on the maintenance pool.
	const before = await withTenantTx(deps.db.app, input.storageAccountId, async (tx) => {
		await findPouch(tx, input.pouchId);
		if (input.artifactIds) {
			const found = await tx
				.select({ id: artifacts.id, deletedAt: artifacts.deletedAt })
				.from(artifacts)
				.where(
					and(
						eq(artifacts.pouchId, input.pouchId),
						inArray(artifacts.id, input.artifactIds),
					),
				);
			if (found.length !== new Set(input.artifactIds).size) throw new AppError('not_found');
			const live = found.filter((row) => row.deletedAt === null).map((row) => row.id);
			if (live.length > 0) throw new AppError('artifact_not_deleted', { artifact_ids: live });
		}
		const [account] = await tx
			.select({ used: storageAccounts.usedBytes })
			.from(storageAccounts)
			.where(eq(storageAccounts.id, input.storageAccountId));
		return account?.used ?? 0;
	});

	await releaseFiles(deps, { ...input, action: 'storage.freed' });

	return withTenantTx(deps.db.app, input.storageAccountId, async (tx) => {
		const [account] = await tx
			.select({ used: storageAccounts.usedBytes, quota: storageAccounts.quotaBytes })
			.from(storageAccounts)
			.where(eq(storageAccounts.id, input.storageAccountId));
		const used = account?.used ?? 0;
		const quota = account?.quota ?? 0;
		return {
			freed_bytes: Math.max(0, before - used),
			used_bytes: used,
			quota_bytes: quota,
			over_quota: used > quota,
		};
	});
}

/**
 * The purge behind `freeSpace` and `trash.empty`, on the maintenance pool:
 * callers have checked ownership and that `artifactIds` are deleted.
 */
export async function releaseFiles(
	deps: Deps,
	input: {
		storageAccountId: string;
		pouchId: string;
		artifactIds?: string[] | undefined;
		actor: string;
		action: string;
	},
): Promise<void> {
	const artifactFilter = input.artifactIds
		? sql`AND r.artifact_id = ANY(${sql.param(input.artifactIds)}::uuid[])`
		: sql``;
	const tombstoneFilter = input.artifactIds
		? sql`AND a.id = ANY(${sql.param(input.artifactIds)}::uuid[])`
		: sql``;
	const removedBlobs = await deps.db.maintenance.transaction(async (tx) => {
		const ids = rows<{ id: string }>(
			await tx.execute(sql`
				WITH pinned AS (
					SELECT unnest(ARRAY[base_revision_id, server_revision_id, incoming_revision_id]) AS id
					FROM conflicts WHERE pouch_id = ${input.pouchId} AND state = 'open'
				)
				SELECT r.id FROM revisions r
				WHERE r.storage_account_id = ${input.storageAccountId} AND r.pouch_id = ${input.pouchId}
					${artifactFilter}
					AND NOT EXISTS (SELECT 1 FROM artifacts a WHERE a.head_revision_id = r.id)
					AND NOT EXISTS (SELECT 1 FROM pinned p WHERE p.id = r.id)
				FOR UPDATE OF r`),
		).map((row) => row.id);
		// Deleted items keep their signed delete (the head revision); only its files go.
		const tombstones = rows<{ id: string }>(
			await tx.execute(sql`
				WITH pinned AS (
					SELECT unnest(ARRAY[base_revision_id, server_revision_id, incoming_revision_id]) AS id
					FROM conflicts WHERE pouch_id = ${input.pouchId} AND state = 'open'
				)
				SELECT a.head_revision_id AS id FROM artifacts a
				WHERE a.storage_account_id = ${input.storageAccountId} AND a.pouch_id = ${input.pouchId}
					${tombstoneFilter}
					AND a.deleted_at IS NOT NULL AND a.head_revision_id IS NOT NULL
					AND NOT EXISTS (SELECT 1 FROM pinned p WHERE p.id = a.head_revision_id)
				FOR UPDATE OF a`),
		).map((row) => row.id);
		const released = [
			...(await releaseRevisions(tx, ids)),
			...(await releaseTombstoneFiles(tx, tombstones)),
		];
		const releasedIds = released
			.filter((row) => row.storage_account_id === input.storageAccountId)
			.map((row) => row.blob_id);
		// Also sweep blobs of this pouch that were already waiting for `gc.blobs`.
		const removed = rows<{ blob_id: Buffer }>(
			await tx.execute(sql`
				DELETE FROM blobs b
				WHERE b.storage_account_id = ${input.storageAccountId} AND b.pouch_id = ${input.pouchId}
					AND b.state = 'stored' AND b.ref_count = 0
					AND (
						b.blob_id = ANY(${sql.param(releasedIds)}::bytea[])
						OR b.unreferenced_since < now() - make_interval(hours => ${Limits.blobGcGraceHours})
					)
					AND NOT EXISTS (
						SELECT 1 FROM revision_blobs rb
						WHERE rb.storage_account_id = b.storage_account_id AND rb.pouch_id = b.pouch_id AND rb.blob_id = b.blob_id
					)
				RETURNING b.blob_id`),
		);
		await recalcAccountUsage(tx, input.storageAccountId);
		await appendAudit(tx, {
			storageAccountId: input.storageAccountId,
			actor: input.actor,
			action: input.action,
			target: `pouch:${input.pouchId}`,
			details: {
				revisions: ids.length,
				tombstones: tombstones.length,
				blobs: removed.length,
				artifacts: input.artifactIds?.length ?? null,
			},
		});
		return removed;
	});

	for (const blob of removedBlobs) {
		await deps.blobs.delete({
			storageAccountId: input.storageAccountId,
			pouchId: input.pouchId,
			blobIdHex: toHex(blob.blob_id),
		});
	}
}
