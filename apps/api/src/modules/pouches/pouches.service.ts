// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Pouches: named, separately keyed sync namespaces.
 * Their names are encrypted inside roster statements; the server only knows
 * IDs, state and counters.
 */
import { Limits } from '@skillpouch/contracts';
import { pouches, storageAccounts } from '@skillpouch/db';
import { and, eq, inArray, ne } from 'drizzle-orm';
import { AppError } from '../../http/app-error';
import { addSeconds } from '../../lib/dates';
import type { Principal } from '../../security/principal';
import type { TenantTx } from '../../security/tenant-tx';
import { countedPouches } from '../entitlements/entitlements.service';

export type PouchRow = typeof pouches.$inferSelect;

/** Throws `pouch_limit_reached` when the account cannot create another pouch. */
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
	assertWritable(pouch);
	return pouch;
}

/** `pouch_locked` for pouches over the plan limit, `pouch_read_only` for archived ones. */
export function assertWritable(pouch: PouchRow): void {
	if (pouch.state === 'locked') throw new AppError('pouch_locked');
	if (pouch.state !== 'active') throw new AppError('pouch_read_only', { state: pouch.state });
}

/**
 * Who may commit to a pouch. A locked pouch is read-only on the web
 * and invisible to the CLI — except that a browser may delete items in it,
 * because deleting is how the user frees space without upgrading.
 */
export function assertCommitAllowed(
	pouch: PouchRow,
	principal: Principal,
	deletesOnly: boolean,
): void {
	if (pouch.state === 'locked' && principal.kind === 'session' && deletesOnly) return;
	assertWritable(pouch);
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

/** `last_pouch` when deleting this pouch would leave the account without one. */
export async function assertNotLastPouch(tx: TenantTx, pouch: PouchRow): Promise<void> {
	const [other] = await tx
		.select({ id: pouches.id })
		.from(pouches)
		.where(
			and(ne(pouches.id, pouch.id), inArray(pouches.state, ['active', 'locked', 'archived'])),
		)
		.limit(1);
	if (!other) throw new AppError('last_pouch');
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
