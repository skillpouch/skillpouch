// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Bootstrap / snapshot-rebase.
 *
 * `POST …/snapshots` records the pouch's current `(epoch, seq = R)`; pages of
 * artifact heads follow, then the client pulls events after R. Pages read the
 * *current* heads, which may be newer than R; that is safe because applying
 * an event whose revision the client already has is a no-op, so the client
 * converges to the same state (heads are immutable, events are ordered).
 */
import { randomUUID } from 'node:crypto';
import { Limits, PouchParam, SnapshotCreated, SnapshotPage, Uuid } from '@skillpouch/contracts';
import { artifacts, snapshots } from '@skillpouch/db';
import { and, asc, eq, gt, isNotNull } from 'drizzle-orm';
import { z } from 'zod';
import type { Deps } from '../../deps';
import { AppError } from '../../http/app-error';
import { decodeCursor, encodeCursor } from '../../http/cursor';
import { principalOf } from '../../http/principal';
import { paginated } from '../../http/serialization';
import type { ZodApp } from '../../http/zod-app';
import { addSeconds } from '../../lib/dates';
import { withTenantTx } from '../../security/tenant-tx';
import { loadRevisionViews } from '../artifacts/artifacts.repo';
import { findPouch } from '../pouches/pouches.service';

export async function snapshotsRoutes(app: ZodApp, deps: Deps) {
	app.post(
		'/v1/pouches/:pouchId/snapshots',
		{
			config: { auth: 'any' },
			schema: {
				tags: ['sync'],
				summary: 'Start a snapshot (bootstrap or rebase)',
				params: PouchParam,
				response: { 200: SnapshotCreated },
			},
		},
		async (request) => {
			const principal = principalOf(request);
			return withTenantTx(deps.db.app, principal.storageAccountId, async (tx) => {
				const pouch = await findPouch(tx, request.params.pouchId);
				const id = randomUUID();
				const expiresAt = addSeconds(deps.now(), Limits.snapshotLeaseSeconds);
				await tx.insert(snapshots).values({
					id,
					storageAccountId: principal.storageAccountId,
					pouchId: pouch.id,
					epoch: pouch.epoch,
					seq: pouch.eventSeq,
					expiresAt,
				});
				return {
					snapshot_id: id,
					epoch: pouch.epoch,
					seq: pouch.eventSeq,
					expires_at: expiresAt.toISOString(),
				};
			});
		},
	);

	app.get(
		'/v1/pouches/:pouchId/snapshots/:snapshotId',
		{
			config: { auth: 'any' },
			schema: {
				tags: ['sync'],
				summary: 'One page of artifact heads (tombstones included)',
				params: PouchParam.extend({ snapshotId: Uuid }),
				querystring: z.object({ cursor: z.string().max(200).optional() }),
				response: { 200: z.object({ items: SnapshotPage.shape.artifacts }) },
			},
		},
		async (request) => {
			const principal = principalOf(request);
			const after = decodeCursor(request.query.cursor);
			return withTenantTx(deps.db.app, principal.storageAccountId, async (tx) => {
				const [snapshot] = await tx
					.select()
					.from(snapshots)
					.where(
						and(
							eq(snapshots.id, request.params.snapshotId),
							eq(snapshots.pouchId, request.params.pouchId),
						),
					);
				if (!snapshot) throw new AppError('not_found');
				if (snapshot.expiresAt <= deps.now()) throw new AppError('snapshot_expired');
				const pouch = await findPouch(tx, snapshot.pouchId);
				if (pouch.epoch !== snapshot.epoch)
					throw new AppError('epoch_mismatch', { epoch: pouch.epoch });

				const conditions = [
					eq(artifacts.pouchId, snapshot.pouchId),
					isNotNull(artifacts.headRevisionId),
				];
				if (after) conditions.push(gt(artifacts.id, after));
				const rows = await tx
					.select()
					.from(artifacts)
					.where(and(...conditions))
					.orderBy(asc(artifacts.id))
					.limit(Limits.snapshotPage + 1);
				const page = rows.slice(0, Limits.snapshotPage);
				const heads = await loadRevisionViews(
					tx,
					page.map((row) => row.headRevisionId!),
				);
				return paginated(
					page.map((row) => ({
						id: row.id,
						name_index: row.nameIndex.toString('base64url'),
						deleted_at: row.deletedAt?.toISOString() ?? null,
						head: heads.get(row.headRevisionId!)!,
					})),
					rows.length > Limits.snapshotPage ? encodeCursor(page.at(-1)!.id) : null,
				);
			});
		},
	);
}
