// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Storage usage and "Free up space" (plan 09 §3.1, 18 §3.3).
 *
 * The server cannot see names or content (E2EE), so it reports sizes per
 * opaque artifact ID and the browser joins them with the names it decrypts.
 * The server never chooses what to delete: items are removed by signed
 * `delete` operations from the browser, and this module only frees the bytes
 * their older versions still hold — immediately, instead of after the 30-day
 * retention window.
 */
import { Limits, toHex } from '@skillpouch/contracts';
import { artifacts, storageAccounts } from '@skillpouch/db';
import { and, eq, inArray, sql } from 'drizzle-orm';
import type { Deps } from '../../deps';
import { AppError } from '../../http/app-error';
import { recalcAccountUsage } from '../../jobs/purge';
import { releaseRevisions } from '../../jobs/retention';
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

	// A revision is "kept" by "Free up space" when it is a head or an open conflict pins it.
	const pouchRows = rows<PouchUsageRow>(
		await tx.execute(sql`
			WITH kept AS (
				SELECT head_revision_id AS id FROM artifacts WHERE head_revision_id IS NOT NULL
				UNION
				SELECT unnest(ARRAY[base_revision_id, server_revision_id, incoming_revision_id])
				FROM conflicts WHERE state = 'open'
			), kept_blobs AS (
				SELECT DISTINCT rb.pouch_id, rb.blob_id FROM revision_blobs rb JOIN kept ON kept.id = rb.revision_id
			)
			SELECT p.id, p.state,
				(COALESCE((SELECT sum(b.stored_size) FROM blobs b WHERE b.pouch_id = p.id AND b.state = 'stored'), 0)
					+ COALESCE((SELECT sum(octet_length(r.envelope)) FROM revisions r WHERE r.pouch_id = p.id), 0))::bigint AS bytes,
				(COALESCE((
					SELECT sum(b.stored_size) FROM blobs b
					WHERE b.pouch_id = p.id AND b.state = 'stored'
						AND NOT EXISTS (SELECT 1 FROM kept_blobs k WHERE k.pouch_id = b.pouch_id AND k.blob_id = b.blob_id)
				), 0)
					+ COALESCE((
						SELECT sum(octet_length(r.envelope)) FROM revisions r
						WHERE r.pouch_id = p.id AND NOT EXISTS (SELECT 1 FROM kept WHERE kept.id = r.id)
					), 0))::bigint AS history_bytes
			FROM pouches p
			ORDER BY p.created_at, p.id`),
	);

	const artifactRows = rows<ArtifactUsageRow>(
		await tx.execute(sql`
			SELECT a.id, a.pouch_id, a.deleted_at IS NOT NULL AS deleted, a.updated_at,
				(COALESCE((SELECT octet_length(r.envelope) FROM revisions r WHERE r.id = a.head_revision_id), 0)
					+ COALESCE((
						SELECT sum(b.stored_size) FROM blobs b
						WHERE b.pouch_id = a.pouch_id
							AND b.blob_id IN (SELECT rb.blob_id FROM revision_blobs rb WHERE rb.revision_id = a.head_revision_id)
					), 0))::bigint AS head_bytes,
				(COALESCE((
					SELECT sum(octet_length(r.envelope)) FROM revisions r
					WHERE r.artifact_id = a.id AND r.id IS DISTINCT FROM a.head_revision_id
				), 0)
					+ COALESCE((
						SELECT sum(b.stored_size) FROM blobs b
						WHERE b.pouch_id = a.pouch_id
							AND b.blob_id IN (
								SELECT rb.blob_id FROM revision_blobs rb JOIN revisions r ON r.id = rb.revision_id
								WHERE r.artifact_id = a.id AND r.id IS DISTINCT FROM a.head_revision_id
							)
							AND b.blob_id NOT IN (
								SELECT rb.blob_id FROM revision_blobs rb WHERE rb.revision_id = a.head_revision_id
							)
					), 0))::bigint AS history_bytes
			FROM artifacts a
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
 * revision of the pouch (history + trash). With them: every non-current
 * revision of those artifacts, which must already be deleted. Revisions an
 * open conflict pins are always kept. Blobs nothing references any more are
 * deleted right away (no 24 h grace — the user asked for the space back).
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

	const artifactFilter = input.artifactIds
		? sql`AND r.artifact_id = ANY(${sql.param(input.artifactIds)}::uuid[])`
		: sql``;
	const removedBlobs = await deps.db.maintenance.transaction(async (tx) => {
		const ids = rows<{ id: string }>(
			await tx.execute(sql`
				SELECT r.id FROM revisions r
				WHERE r.storage_account_id = ${input.storageAccountId} AND r.pouch_id = ${input.pouchId}
					${artifactFilter}
					AND NOT EXISTS (SELECT 1 FROM artifacts a WHERE a.head_revision_id = r.id)
					AND NOT EXISTS (
						SELECT 1 FROM conflicts c
						WHERE c.state = 'open'
							AND r.id IN (c.base_revision_id, c.server_revision_id, c.incoming_revision_id)
					)
				FOR UPDATE OF r`),
		).map((row) => row.id);
		const released = await releaseRevisions(tx, ids);
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
			action: 'storage.freed',
			target: `pouch:${input.pouchId}`,
			details: {
				revisions: ids.length,
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
