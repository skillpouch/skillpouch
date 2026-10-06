// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Blob garbage collection (plan 06 §6–7, 09 §3).
 *
 *  gc.blobs   — unreferenced (`ref_count = 0`) for longer than the 24 h grace:
 *               delete the row first (re-checked under lock), then the object.
 *               A crash between the two leaves an orphan file, never a row
 *               pointing at a missing object.
 *  gc.pending — quota reservations from `blobs/check` that were never
 *               uploaded within an hour are released.
 */
import { Limits, toHex } from '@skillpouch/contracts';
import { sql } from 'drizzle-orm';
import type { Deps } from '../deps';
import { rows } from './sql';

const BATCH = 500;

export async function gcBlobs(deps: Deps): Promise<number> {
	let total = 0;
	for (;;) {
		const removed = await deps.db.maintenance.transaction(async (tx) => {
			const victims = rows<{
				storage_account_id: string;
				pouch_id: string;
				blob_id: Buffer;
				stored_size: number;
			}>(
				await tx.execute(sql`
					DELETE FROM blobs b
					WHERE (b.storage_account_id, b.pouch_id, b.blob_id) IN (
						SELECT storage_account_id, pouch_id, blob_id FROM blobs
						WHERE state = 'stored' AND ref_count = 0
							AND unreferenced_since < now() - make_interval(hours => ${Limits.blobGcGraceHours})
						LIMIT ${BATCH}
						FOR UPDATE SKIP LOCKED
					)
					AND b.ref_count = 0
					AND NOT EXISTS (
						SELECT 1 FROM revision_blobs rb
						WHERE rb.storage_account_id = b.storage_account_id AND rb.pouch_id = b.pouch_id AND rb.blob_id = b.blob_id
					)
					RETURNING b.storage_account_id, b.pouch_id, b.blob_id, b.stored_size`),
			);
			const freed = new Map<string, number>();
			for (const victim of victims) {
				freed.set(
					victim.storage_account_id,
					(freed.get(victim.storage_account_id) ?? 0) + Number(victim.stored_size),
				);
			}
			for (const [accountId, bytes] of freed) {
				await tx.execute(
					sql`UPDATE storage_accounts SET used_bytes = GREATEST(0, used_bytes - ${bytes}) WHERE id = ${accountId}`,
				);
			}
			return victims;
		});
		for (const victim of removed) {
			await deps.blobs.delete({
				storageAccountId: victim.storage_account_id,
				pouchId: victim.pouch_id,
				blobIdHex: toHex(victim.blob_id),
			});
		}
		total += removed.length;
		if (removed.length < BATCH) return total;
	}
}

export async function gcPending(deps: Deps): Promise<number> {
	return deps.db.maintenance.transaction(async (tx) => {
		const released = rows<{ storage_account_id: string; stored_size: number }>(
			await tx.execute(sql`
				DELETE FROM blobs
				WHERE state = 'pending'
					AND created_at < now() - make_interval(mins => ${Limits.pendingBlobTtlMinutes})
				RETURNING storage_account_id, stored_size`),
		);
		const perAccount = new Map<string, number>();
		for (const row of released) {
			perAccount.set(
				row.storage_account_id,
				(perAccount.get(row.storage_account_id) ?? 0) + Number(row.stored_size),
			);
		}
		for (const [accountId, bytes] of perAccount) {
			await tx.execute(
				sql`UPDATE storage_accounts SET pending_bytes = GREATEST(0, pending_bytes - ${bytes}) WHERE id = ${accountId}`,
			);
		}
		return released.length;
	});
}
