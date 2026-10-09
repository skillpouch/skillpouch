// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Conflicts, encrypted bindings and anti-fork checkpoints. Conflict *resolution* is a signed `resolve` operation
 * through the normal commit path, so it cannot lose concurrent updates.
 */
import {
	Binding,
	BindingsPut,
	Checkpoint,
	CheckpointPut,
	Conflict,
	ConflictListQuery,
	Empty,
	PouchParam,
	Uuid,
	fromBase64Url,
	toBase64Url,
} from '@skillpouch/contracts';
import { artifacts, bindings, checkpoints, conflicts } from '@skillpouch/db';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import type { Deps } from '../../deps';
import { AppError } from '../../http/app-error';
import { deviceOf, memberOf, principalOf } from '../../http/principal';
import type { ZodApp } from '../../http/zod-app';
import { notifyPouch } from '../../infra/notify';
import { CONTEXT, concatBytes, verifyMemberSignature } from '../../security/e2ee-structure';
import { withTenantTx } from '../../security/tenant-tx';
import { appendEvent } from '../events/events.repo';
import { findPouch } from '../pouches/pouches.service';
import { loadMembers } from '../roster/roster.service';

function conflictView(row: typeof conflicts.$inferSelect, headRevisionId: string | null) {
	return {
		id: row.id,
		artifact_id: row.artifactId,
		type: row.type,
		base_revision_id: row.baseRevisionId,
		server_revision_id: row.serverRevisionId,
		incoming_revision_id: row.incomingRevisionId,
		head_revision_id: headRevisionId,
		device_id: row.deviceId,
		state: row.state,
		resolution: row.resolution,
		created_at: row.createdAt.toISOString(),
		resolved_at: row.resolvedAt?.toISOString() ?? null,
	};
}

export async function conflictsRoutes(app: ZodApp, deps: Deps) {
	app.get(
		'/v1/pouches/:pouchId/conflicts',
		{
			config: { auth: 'any' },
			schema: {
				tags: ['artifacts'],
				params: PouchParam,
				querystring: ConflictListQuery,
				response: { 200: z.object({ conflicts: z.array(Conflict) }) },
			},
		},
		async (request) => {
			const principal = principalOf(request);
			return withTenantTx(deps.db.app, principal.storageAccountId, async (tx) => {
				await findPouch(tx, request.params.pouchId, { includeDeleted: true });
				const conditions = [eq(conflicts.pouchId, request.params.pouchId)];
				if (request.query.state) conditions.push(eq(conflicts.state, request.query.state));
				const rows = await tx
					.select({ conflict: conflicts, head: artifacts.headRevisionId })
					.from(conflicts)
					.leftJoin(artifacts, eq(artifacts.id, conflicts.artifactId))
					.where(and(...conditions))
					.orderBy(desc(conflicts.createdAt))
					.limit(500);
				return { conflicts: rows.map((row) => conflictView(row.conflict, row.head)) };
			});
		},
	);

	app.get(
		'/v1/pouches/:pouchId/conflicts/:conflictId',
		{
			config: { auth: 'any' },
			schema: {
				tags: ['artifacts'],
				params: PouchParam.extend({ conflictId: Uuid }),
				response: { 200: Conflict },
			},
		},
		async (request) => {
			const principal = principalOf(request);
			return withTenantTx(deps.db.app, principal.storageAccountId, async (tx) => {
				const [row] = await tx
					.select({ conflict: conflicts, head: artifacts.headRevisionId })
					.from(conflicts)
					.leftJoin(artifacts, eq(artifacts.id, conflicts.artifactId))
					.where(
						and(
							eq(conflicts.id, request.params.conflictId),
							eq(conflicts.pouchId, request.params.pouchId),
						),
					);
				if (!row) throw new AppError('not_found');
				return conflictView(row.conflict, row.head);
			});
		},
	);

	app.get(
		'/v1/pouches/:pouchId/bindings',
		{
			config: { auth: 'any' },
			schema: {
				tags: ['artifacts'],
				summary: 'Encrypted binding mirror (where each artifact is installed)',
				params: PouchParam,
				response: { 200: z.object({ bindings: z.array(Binding) }) },
			},
		},
		async (request) => {
			const principal = principalOf(request);
			return withTenantTx(deps.db.app, principal.storageAccountId, async (tx) => {
				await findPouch(tx, request.params.pouchId, { includeDeleted: true });
				const rows = await tx
					.select()
					.from(bindings)
					.where(eq(bindings.pouchId, request.params.pouchId));
				return {
					bindings: rows.map((row) => ({
						artifact_id: row.artifactId,
						device_id: row.deviceId,
						payload: toBase64Url(row.payload),
						key_gen: row.keyGen,
						updated_at: row.updatedAt.toISOString(),
					})),
				};
			});
		},
	);

	app.put(
		'/v1/pouches/:pouchId/bindings',
		{
			config: { auth: 'device' },
			schema: {
				tags: ['artifacts'],
				summary: 'Upsert (or delete with payload=null) this device’s encrypted bindings',
				params: PouchParam,
				body: BindingsPut,
				response: { 200: Empty },
			},
		},
		async (request) => {
			const principal = deviceOf(request);
			await withTenantTx(deps.db.app, principal.storageAccountId, async (tx) => {
				const pouch = await findPouch(tx, request.params.pouchId, { lock: true });
				const ids = [
					...new Set(request.body.bindings.map((binding) => binding.artifact_id)),
				];
				const found = await tx
					.select({ id: artifacts.id })
					.from(artifacts)
					.where(and(eq(artifacts.pouchId, pouch.id), inArray(artifacts.id, ids)));
				if (found.length !== ids.length) throw new AppError('not_found');
				for (const binding of request.body.bindings) {
					if (binding.payload === null) {
						await tx
							.delete(bindings)
							.where(
								and(
									eq(bindings.artifactId, binding.artifact_id),
									eq(bindings.deviceId, principal.deviceId),
								),
							);
						continue;
					}
					const payload = Buffer.from(fromBase64Url(binding.payload));
					await tx
						.insert(bindings)
						.values({
							storageAccountId: principal.storageAccountId,
							pouchId: pouch.id,
							artifactId: binding.artifact_id,
							deviceId: principal.deviceId,
							payload,
							keyGen: binding.key_gen,
						})
						.onConflictDoUpdate({
							target: [bindings.artifactId, bindings.deviceId],
							set: { payload, keyGen: binding.key_gen, updatedAt: deps.now() },
						});
				}
				const seq = await appendEvent(tx, {
					storageAccountId: principal.storageAccountId,
					pouchId: pouch.id,
					epoch: pouch.epoch,
					type: 'binding.changed',
					deviceId: principal.deviceId,
					payload: { artifact_ids: ids },
				});
				await notifyPouch(tx, principal.storageAccountId, pouch.id, seq);
			});
			return {};
		},
	);

	app.put(
		'/v1/pouches/:pouchId/checkpoints/me',
		{
			config: { auth: 'any' },
			schema: {
				tags: ['sync'],
				summary: 'Store this member’s signed (seq, roster head) checkpoint (anti-fork)',
				params: PouchParam,
				body: CheckpointPut,
				response: { 200: Empty },
			},
		},
		async (request) => {
			const principal = principalOf(request);
			const memberId = memberOf(principal);
			if (request.body.member_id !== memberId)
				throw new AppError('forbidden', { reason: 'only your own checkpoint' });
			await withTenantTx(deps.db.app, principal.storageAccountId, async (tx) => {
				const pouch = await findPouch(tx, request.params.pouchId);
				const member = (await loadMembers(tx)).get(memberId)!;
				const rosterHead = Buffer.from(fromBase64Url(request.body.roster_head));
				const seq = Buffer.alloc(8);
				seq.writeBigUInt64BE(BigInt(request.body.pouch_seq));
				const message = concatBytes(pouch.id, seq, rosterHead);
				if (
					!verifyMemberSignature(
						member.signPub,
						request.body.signature,
						CONTEXT.checkpoint,
						message,
					)
				) {
					throw new AppError('signature_invalid');
				}
				const values = {
					storageAccountId: principal.storageAccountId,
					pouchId: pouch.id,
					memberId,
					pouchSeq: request.body.pouch_seq,
					rosterHead,
					signature: Buffer.from(fromBase64Url(request.body.signature)),
				};
				await tx
					.insert(checkpoints)
					.values(values)
					.onConflictDoUpdate({
						target: [checkpoints.pouchId, checkpoints.memberId],
						set: {
							pouchSeq: values.pouchSeq,
							rosterHead,
							signature: values.signature,
							createdAt: deps.now(),
						},
					});
			});
			return {};
		},
	);

	app.get(
		'/v1/pouches/:pouchId/checkpoints',
		{
			config: { auth: 'any' },
			schema: {
				tags: ['sync'],
				params: PouchParam,
				response: { 200: z.object({ checkpoints: z.array(Checkpoint) }) },
			},
		},
		async (request) => {
			const principal = principalOf(request);
			return withTenantTx(deps.db.app, principal.storageAccountId, async (tx) => {
				await findPouch(tx, request.params.pouchId);
				const rows = await tx
					.select()
					.from(checkpoints)
					.where(eq(checkpoints.pouchId, request.params.pouchId));
				return {
					checkpoints: rows.map((row) => ({
						member_id: row.memberId,
						pouch_seq: row.pouchSeq,
						roster_head: toBase64Url(row.rosterHead),
						signature: toBase64Url(row.signature),
						created_at: row.createdAt.toISOString(),
					})),
				};
			});
		},
	);
}
