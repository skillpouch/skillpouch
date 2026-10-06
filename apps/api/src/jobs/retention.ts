// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Retention jobs (plan 03 §7, 06 §7). Cross-tenant, fixed SQL on the
 * maintenance pool. Every job is idempotent and safe to run concurrently:
 * rows are claimed with `FOR UPDATE SKIP LOCKED` in bounded batches.
 */
import { Limits } from '@skillpouch/contracts';
import { sql } from 'drizzle-orm';
import type { Deps } from '../deps';
import { rows } from './sql';

const BATCH = 500;

/**
 * Deletes expired, non-head revisions that no open conflict pins, and
 * releases their blob references (blobs then age out through `gc.blobs`).
 */
export async function expireRevisions(deps: Deps): Promise<number> {
	let total = 0;
	for (;;) {
		const deleted = await deps.db.maintenance.transaction(async (tx) => {
			const expired = rows<{
				id: string;
				storage_account_id: string;
				envelope_bytes: number;
			}>(
				await tx.execute(sql`
					SELECT r.id, r.storage_account_id, octet_length(r.envelope) AS envelope_bytes
					FROM revisions r
					WHERE r.expires_at < now()
						AND NOT EXISTS (SELECT 1 FROM artifacts a WHERE a.head_revision_id = r.id)
						AND NOT EXISTS (
							SELECT 1 FROM conflicts c
							WHERE c.state = 'open'
								AND r.id IN (c.base_revision_id, c.server_revision_id, c.incoming_revision_id)
						)
					ORDER BY r.expires_at
					LIMIT ${BATCH}
					FOR UPDATE OF r SKIP LOCKED`),
			);
			if (expired.length === 0) return 0;
			await releaseRevisions(
				tx,
				expired.map((row) => row.id),
			);
			const perAccount = new Map<string, number>();
			for (const row of expired) {
				perAccount.set(
					row.storage_account_id,
					(perAccount.get(row.storage_account_id) ?? 0) + Number(row.envelope_bytes),
				);
			}
			for (const [accountId, bytes] of perAccount) {
				await tx.execute(
					sql`UPDATE storage_accounts SET used_bytes = GREATEST(0, used_bytes - ${bytes}) WHERE id = ${accountId}`,
				);
			}
			return expired.length;
		});
		total += deleted;
		if (deleted < BATCH) return total;
	}
}

type Tx = Parameters<Parameters<Deps['db']['maintenance']['transaction']>[0]>[0];

export interface ReleasedBlob {
	storage_account_id: string;
	pouch_id: string;
	blob_id: Buffer;
	ref_count: number;
}

/**
 * Deletes revisions and releases their blob references. Blobs that drop to
 * `ref_count = 0` are returned; `gc.blobs` removes them after the grace
 * period, or the caller removes them right away (`storage/free-space`).
 * Callers must have excluded head revisions and revisions open conflicts pin.
 */
export async function releaseRevisions(tx: Tx, ids: string[]): Promise<ReleasedBlob[]> {
	if (ids.length === 0) return [];
	const released = rows<ReleasedBlob>(
		await tx.execute(sql`
			WITH released AS (
				DELETE FROM revision_blobs WHERE revision_id = ANY(${sql.param(ids)}::uuid[])
				RETURNING storage_account_id, pouch_id, blob_id
			), counts AS (
				SELECT storage_account_id, pouch_id, blob_id, count(*) AS n FROM released GROUP BY 1, 2, 3
			)
			UPDATE blobs b
			SET ref_count = GREATEST(0, b.ref_count - counts.n),
				unreferenced_since = CASE WHEN b.ref_count - counts.n <= 0 THEN now() ELSE b.unreferenced_since END
			FROM counts
			WHERE b.storage_account_id = counts.storage_account_id
				AND b.pouch_id = counts.pouch_id AND b.blob_id = counts.blob_id
			RETURNING b.storage_account_id, b.pouch_id, b.blob_id, b.ref_count`),
	);
	// Children keep their history readable: a deleted parent becomes a dangling (null) link.
	await tx.execute(
		sql`UPDATE revisions SET parent_id = NULL WHERE parent_id = ANY(${sql.param(ids)}::uuid[])`,
	);
	await tx.execute(
		sql`UPDATE revisions SET merge_parent_id = NULL WHERE merge_parent_id = ANY(${sql.param(ids)}::uuid[])`,
	);
	await tx.execute(
		sql`UPDATE conflicts SET incoming_revision_id = NULL WHERE state <> 'open' AND incoming_revision_id = ANY(${sql.param(ids)}::uuid[])`,
	);
	await tx.execute(sql`DELETE FROM revisions WHERE id = ANY(${sql.param(ids)}::uuid[])`);
	return released.filter((row) => Number(row.ref_count) === 0);
}

/** Deletes events older than 90 days and records the purge horizon per pouch. */
export async function purgeEvents(deps: Deps): Promise<number> {
	const result = rows<{ n: number }>(
		await deps.db.maintenance.execute(sql`
			WITH purged AS (
				DELETE FROM events
				WHERE created_at < now() - make_interval(days => ${Limits.eventRetentionDays})
				RETURNING pouch_id, seq
			), horizon AS (
				SELECT pouch_id, max(seq) AS seq FROM purged GROUP BY pouch_id
			), updated AS (
				UPDATE pouches p SET events_purged_through = GREATEST(p.events_purged_through, horizon.seq)
				FROM horizon WHERE p.id = horizon.pouch_id
				RETURNING 1
			)
			SELECT (SELECT count(*) FROM purged)::int AS n`),
	);
	return result[0]?.n ?? 0;
}

/** Deletes idempotency receipts older than 30 days. */
export async function purgeReceipts(deps: Deps): Promise<number> {
	const result = await deps.db.maintenance.execute(sql`
		DELETE FROM operation_receipts
		WHERE created_at < now() - make_interval(days => ${Limits.receiptRetentionDays})`);
	return result.rowCount ?? 0;
}
