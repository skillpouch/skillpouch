// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Pouches: named, separately keyed sync namespaces (plan 16 §1, 15 §7.5).
 * Their names are encrypted inside roster statements; the server only knows
 * IDs, state and counters.
 */
import { Limits } from '@skillpouch/contracts';
import { pouches, storageAccounts } from '@skillpouch/db';
import { eq } from 'drizzle-orm';
import { AppError } from '../../http/app-error';
import { addSeconds } from '../../lib/dates';
import type { TenantTx } from '../../security/tenant-tx';
import { countedPouches } from '../entitlements/entitlements.service';

export type PouchRow = typeof pouches.$inferSelect;

/** Throws `pouch_limit_reached` when the account cannot create another pouch (18 §3.3). */
export async function assertPouchAllowance(tx: TenantTx, storageAccountId: string): Promise<void> {
	const [account] = await tx
		.select({ entitlements: storageAccounts.entitlements })
		.from(storageAccounts)
		.where(eq(storageAccounts.id, storageAccountId));
	const limit = account?.entitlements.pouch_limit ?? 0;
	const current = await countedPouches(tx);
	if (current >= limit) throw new AppError('pouch_limit_reached', { limit, current });
}

/** A pouch of the caller's account; deleted pouches are not found (unless asked for). */
export async function findPouch(
	tx: TenantTx,
	pouchId: string,
	options: { lock?: boolean; includeDeleted?: boolean } = {},
): Promise<PouchRow> {
	const query = tx.select().from(pouches).where(eq(pouches.id, pouchId));
	const [pouch] = options.lock ? await query.for('update') : await query;
	if (!pouch || (pouch.state === 'deleted' && !options.includeDeleted))
		throw new AppError('not_found');
	return pouch;
}

/** Same as `findPouch` but also requires the pouch to accept new data. */
export async function findWritablePouch(
	tx: TenantTx,
	pouchId: string,
	lock = false,
): Promise<PouchRow> {
	const pouch = await findPouch(tx, pouchId, { lock });
	if (pouch.state !== 'active') throw new AppError('pouch_read_only', { state: pouch.state });
	return pouch;
}

export function pouchView(pouch: PouchRow) {
	return {
		id: pouch.id,
		state: pouch.state,
		epoch: pouch.epoch,
		event_seq: pouch.eventSeq,
		key_gen: pouch.keyGen,
		created_seq: pouch.createdSeq,
		delete_after: pouch.deleteAfter?.toISOString() ?? null,
		created_at: pouch.createdAt.toISOString(),
	};
}

export async function markPouchDeleted(
	tx: TenantTx,
	pouch: PouchRow,
	now: Date,
): Promise<PouchRow> {
	const [updated] = await tx
		.update(pouches)
		.set({
			state: 'deleted',
			deleteAfter: addSeconds(now, Limits.undoWindowDays * 86400),
			updatedAt: now,
		})
		.where(eq(pouches.id, pouch.id))
		.returning();
	return updated!;
}
