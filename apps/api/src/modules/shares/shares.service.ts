// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Share links.
 *
 * Owner side (tenant transactions): create, list, revoke.
 * Recipient side: anyone with the link may read the share's public metadata
 * and — unless it is one-time — download the sealed bundle. A one-time bundle
 * is handed out once, to a signed-in recipient, and the link is used up.
 *
 * Recipient queries run with `app.share_id` set, which the `share_by_id` RLS
 * policies accept for exactly that one row; `app.sa_id` is the nil UUID so no
 * tenant row is visible.
 *
 * The ciphertext is counted in the owner's storage until the link is revoked,
 * used up or expired; then it is dropped and only the counters remain.
 */
import type { ShareCreate } from '@skillpouch/contracts';
import { Limits, fromBase64Url, toBase64Url } from '@skillpouch/contracts';
import { shares, storageAccounts, type Database } from '@skillpouch/db';
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import type { z } from 'zod';
import type { Deps } from '../../deps';
import { AppError } from '../../http/app-error';
import { addSeconds } from '../../lib/dates';
import { notifyAccount } from '../../infra/notify';
import { appendAudit } from '../../security/audit';
import type { Principal, SessionPrincipal } from '../../security/principal';
import { principalLabel } from '../../security/principal';
import { withTenantTx } from '../../security/tenant-tx';
import { lockAccount } from '../blobs/blobs.service';
import { findWritablePouch } from '../pouches/pouches.service';

type ShareRow = typeof shares.$inferSelect;
type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];

const NIL_UUID = '00000000-0000-0000-0000-000000000000';

const EXPIRY_SECONDS = {
	'1d': 86_400,
	'7d': 7 * 86_400,
	'30d': 30 * 86_400,
	never: null,
} as const;

function stateOf(row: ShareRow, now: Date) {
	if (row.revokedAt) return 'revoked' as const;
	if (row.consumedAt) return 'consumed' as const;
	if (row.expiresAt && row.expiresAt <= now) return 'expired' as const;
	return 'active' as const;
}

function shareView(row: ShareRow, now: Date) {
	return {
		id: row.id,
		pouch_id: row.pouchId,
		label_enc: toBase64Url(row.labelEnc),
		state: stateOf(row, now),
		one_time: row.oneTime,
		size: row.storedSize,
		views: row.views,
		imports: row.imports,
		expires_at: row.expiresAt?.toISOString() ?? null,
		revoked_at: row.revokedAt?.toISOString() ?? null,
		last_imported_at: row.lastImportedAt?.toISOString() ?? null,
		created_at: row.createdAt.toISOString(),
	};
}

function publicView(row: ShareRow, now: Date) {
	return {
		id: row.id,
		state: stateOf(row, now),
		one_time: row.oneTime,
		size: row.storedSize,
		expires_at: row.expiresAt?.toISOString() ?? null,
		created_at: row.createdAt.toISOString(),
	};
}

/** Drops a share's ciphertext and gives its bytes back to the owner's quota. */
async function releaseCiphertext(tx: Transaction, row: ShareRow) {
	if (row.storedSize === 0) return;
	await tx
		.update(shares)
		.set({ ciphertext: Buffer.alloc(0), storedSize: 0 })
		.where(eq(shares.id, row.id));
	await tx
		.update(storageAccounts)
		.set({ usedBytes: sql`GREATEST(0, ${storageAccounts.usedBytes} - ${row.storedSize})` })
		.where(eq(storageAccounts.id, row.storageAccountId));
}

export async function createShare(
	deps: Deps,
	principal: SessionPrincipal,
	pouchId: string,
	input: z.infer<typeof ShareCreate>,
) {
	if (!principal.memberId)
		throw new AppError('member_inactive', { reason: 'unlock this browser first' });
	const bundle = Buffer.from(fromBase64Url(input.bundle));
	const labelEnc = Buffer.from(fromBase64Url(input.label_enc));
	if (bundle.length === 0 || bundle.length > Limits.shareMaxBytes)
		throw new AppError('validation_failed', { reason: 'bundle size' });
	if (labelEnc.length === 0) throw new AppError('validation_failed', { reason: 'label' });

	return withTenantTx(deps.db.app, principal.storageAccountId, async (tx) => {
		await findWritablePouch(tx, pouchId);
		const account = await lockAccount(tx, principal.storageAccountId);
		if (account.usedBytes + account.pendingBytes + bundle.length > account.quotaBytes) {
			throw new AppError('quota_exceeded', {
				quota_bytes: account.quotaBytes,
				used_bytes: account.usedBytes,
				requested_bytes: bundle.length,
			});
		}
		const active = await tx.execute(
			sql`SELECT count(*)::int AS n FROM shares
				WHERE revoked_at IS NULL AND consumed_at IS NULL
					AND (expires_at IS NULL OR expires_at > now())`,
		);
		if (Number(active.rows[0]?.n ?? 0) >= Limits.sharesMaxActive)
			throw new AppError('rate_limited', { reason: 'too many active share links' });

		const seconds = EXPIRY_SECONDS[input.expires];
		const [row] = await tx
			.insert(shares)
			.values({
				id: input.id,
				storageAccountId: principal.storageAccountId,
				pouchId,
				createdByMember: principal.memberId!,
				labelEnc,
				ciphertext: bundle,
				storedSize: bundle.length,
				oneTime: input.one_time,
				expiresAt: seconds === null ? null : addSeconds(deps.now(), seconds),
			})
			.onConflictDoNothing()
			.returning();
		if (!row) throw new AppError('precondition_failed', { reason: 'share id already used' });
		await tx
			.update(storageAccounts)
			.set({ usedBytes: sql`${storageAccounts.usedBytes} + ${bundle.length}` })
			.where(eq(storageAccounts.id, principal.storageAccountId));
		await appendAudit(tx, {
			storageAccountId: principal.storageAccountId,
			actor: principalLabel(principal),
			action: 'share.created',
			target: `share:${row.id}`,
			details: { one_time: input.one_time, expires: input.expires },
		});
		await notifyAccount(tx, principal.storageAccountId, 'usage.changed');
		return shareView(row, deps.now());
	});
}

export async function listShares(deps: Deps, principal: Principal) {
	return withTenantTx(deps.db.app, principal.storageAccountId, async (tx) => {
		const rows = await tx
			.select()
			.from(shares)
			.where(eq(shares.storageAccountId, principal.storageAccountId))
			.orderBy(desc(shares.createdAt));
		return { shares: rows.map((row) => shareView(row, deps.now())) };
	});
}

export async function revokeShare(deps: Deps, principal: SessionPrincipal, id: string) {
	return withTenantTx(deps.db.app, principal.storageAccountId, async (tx) => {
		const [row] = await tx.select().from(shares).where(eq(shares.id, id)).for('update');
		if (!row) throw new AppError('not_found');
		if (row.revokedAt) return shareView(row, deps.now());
		await lockAccount(tx, principal.storageAccountId);
		await releaseCiphertext(tx, row);
		const [updated] = await tx
			.update(shares)
			.set({ revokedAt: deps.now() })
			.where(eq(shares.id, id))
			.returning();
		await appendAudit(tx, {
			storageAccountId: principal.storageAccountId,
			actor: principalLabel(principal),
			action: 'share.revoked',
			target: `share:${id}`,
		});
		await notifyAccount(tx, principal.storageAccountId, 'usage.changed');
		return shareView(updated!, deps.now());
	});
}

/** Runs `fn` in a transaction that can see exactly one share, and no tenant rows. */
async function withShare<T>(
	deps: Deps,
	id: string,
	fn: (tx: Transaction, row: ShareRow) => Promise<T>,
): Promise<T> {
	return deps.db.app.transaction(async (tx) => {
		await tx.execute(
			sql`SELECT set_config('app.sa_id', ${NIL_UUID}, true), set_config('app.share_id', ${id}, true)`,
		);
		const [row] = await tx.select().from(shares).where(eq(shares.id, id)).for('update');
		if (!row) throw new AppError('not_found');
		return fn(tx, row);
	});
}

function assertOpenable(row: ShareRow, now: Date) {
	const state = stateOf(row, now);
	if (state !== 'active') throw new AppError('share_unavailable', { state });
}

/** Public metadata: whether the link still works, its size and expiry. */
export async function getPublicShare(deps: Deps, id: string) {
	return withShare(deps, id, async (_tx, row) => publicView(row, deps.now()));
}

/** Public download of a reusable link's bundle; counts a view. */
export async function downloadShare(deps: Deps, id: string) {
	return withShare(deps, id, async (tx, row) => {
		assertOpenable(row, deps.now());
		if (row.oneTime) throw new AppError('forbidden', { reason: 'one-time link: claim it' });
		await tx
			.update(shares)
			.set({ views: sql`${shares.views} + 1` })
			.where(eq(shares.id, id));
		return row.ciphertext;
	});
}

/** A signed-in recipient takes a one-time link's bundle; the link is used up. */
export async function claimShare(deps: Deps, id: string) {
	const { row, bundle } = await withShare(deps, id, async (tx, row) => {
		assertOpenable(row, deps.now());
		if (!row.oneTime)
			throw new AppError('validation_failed', { reason: 'not a one-time link' });
		const bundle = row.ciphertext;
		await tx
			.update(shares)
			.set({
				consumedAt: deps.now(),
				views: sql`${shares.views} + 1`,
				imports: sql`${shares.imports} + 1`,
				lastImportedAt: deps.now(),
				ciphertext: Buffer.alloc(0),
				storedSize: 0,
			})
			.where(and(eq(shares.id, id), isNull(shares.consumedAt)));
		return { row, bundle };
	});
	await releaseOwnerBytes(deps, row);
	return { bundle: toBase64Url(bundle) };
}

/** A recipient added a reusable link's item to their pouch. */
export async function recordShareImport(deps: Deps, id: string) {
	return withShare(deps, id, async (tx, row) => {
		assertOpenable(row, deps.now());
		if (row.oneTime) throw new AppError('validation_failed', { reason: 'one-time link' });
		await tx
			.update(shares)
			.set({ imports: sql`${shares.imports} + 1`, lastImportedAt: deps.now() })
			.where(eq(shares.id, id));
		return {};
	});
}

/**
 * The owner's usage lives in their tenant; the claim transaction cannot touch
 * it, so the bytes are released in the owner's own tenant transaction.
 */
async function releaseOwnerBytes(deps: Deps, row: ShareRow) {
	await withTenantTx(deps.db.app, row.storageAccountId, async (tx) => {
		await tx
			.update(storageAccounts)
			.set({ usedBytes: sql`GREATEST(0, ${storageAccounts.usedBytes} - ${row.storedSize})` })
			.where(eq(storageAccounts.id, row.storageAccountId));
		await appendAudit(tx, {
			storageAccountId: row.storageAccountId,
			actor: 'recipient',
			action: 'share.claimed',
			target: `share:${row.id}`,
		});
		await notifyAccount(tx, row.storageAccountId, 'usage.changed');
	});
}
