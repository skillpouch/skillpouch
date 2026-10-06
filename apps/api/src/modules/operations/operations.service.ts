// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The commit transaction — the heart of sync.
 *
 * One Postgres transaction (READ COMMITTED) with a fixed lock order
 * storage_account → pouch → artifacts (sorted by id), so concurrent commits
 * cannot deadlock. Every accepted head change appends exactly one event.
 *
 * Per operation the server checks only what it can see under E2EE: IDs,
 * key generation, sealed-envelope header, the member signature, blob
 * presence, blind name-index uniqueness and the base revision. A stale base
 * never overwrites: the incoming revision is stored (non-head) and a
 * conflict is recorded, so nothing anyone wrote is lost.
 *
 * Idempotency: the response is stored in `operation_receipts`; a retry with
 * the same `operation_id` and body gets the same response, a different body
 * gets `operation_id_reused`.
 */
import { randomUUID } from 'node:crypto';
import {
	Limits,
	canonicalDigest,
	fromBase64Url,
	parseSealedHeader,
	type CommitRequest,
	type CommitResponse,
	type ErrorCode,
	type EventType,
	type Operation,
	type OperationResult,
} from '@skillpouch/contracts';
import {
	artifacts,
	blobs,
	conflicts,
	operationReceipts,
	pouches,
	revisionBlobs,
	revisions,
	storageAccounts,
	type ConflictType,
	type RevisionOrigin,
} from '@skillpouch/db';
import { and, asc, eq, inArray, isNull, ne, sql } from 'drizzle-orm';
import type { Deps } from '../../deps';
import { AppError } from '../../http/app-error';
import { notifyPouch } from '../../infra/notify';
import { blake3Hash } from '../../security/crypto-util';
import {
	CONTEXT,
	revisionSignedMessage,
	verifyMemberSignature,
} from '../../security/e2ee-structure';
import type { Principal } from '../../security/principal';
import { withTenantTx, type TenantTx } from '../../security/tenant-tx';
import { appendEvent } from '../events/events.repo';
import { assertCommitAllowed, findPouch, type PouchRow } from '../pouches/pouches.service';
import { isActiveMember, loadMembers } from '../roster/roster.service';

type ArtifactRow = typeof artifacts.$inferSelect;

/** A per-operation rejection: recorded in the response, does not abort the batch. */
class OperationRejected extends Error {
	constructor(
		readonly code: ErrorCode,
		readonly reason: string,
	) {
		super(reason);
	}
}

interface CommitContext {
	tx: TenantTx;
	deps: Deps;
	principal: Principal;
	pouch: PouchRow;
	operationId: string;
	origin: RevisionOrigin;
	members: Awaited<ReturnType<typeof loadMembers>>;
	artifactsById: Map<string, ArtifactRow>;
	envelopeBytesAdded: number;
	now: Date;
}

const EVENT_FOR: Record<Operation['type'], EventType> = {
	create: 'artifact.created',
	update: 'artifact.updated',
	rename: 'artifact.renamed',
	delete: 'artifact.deleted',
	restore: 'artifact.restored',
	resolve: 'artifact.updated',
};

export interface CommitInput {
	pouchId: string;
	request: CommitRequest;
	/** Already-verified device signature header (device principals). */
	signature: string | null;
}

export async function commitOperations(
	deps: Deps,
	principal: Principal,
	input: CommitInput,
): Promise<CommitResponse> {
	const digest = Buffer.from(canonicalDigest(input.request));
	const signerMember = principal.memberId;
	if (!signerMember)
		throw new AppError('member_inactive', { reason: 'this client is not enrolled' });

	const response = await withTenantTx(
		deps.db.app,
		principal.storageAccountId,
		async (tx) => {
			await tx
				.select({ id: storageAccounts.id })
				.from(storageAccounts)
				.where(eq(storageAccounts.id, principal.storageAccountId))
				.for('update');

			const [receipt] = await tx
				.select()
				.from(operationReceipts)
				.where(
					and(
						eq(operationReceipts.pouchId, input.pouchId),
						eq(operationReceipts.operationId, input.request.operation_id),
					),
				);
			if (receipt) {
				if (!receipt.requestDigest.equals(digest))
					throw new AppError('operation_id_reused');
				return { replayed: true as const, body: receipt.response as CommitResponse };
			}

			const pouch = await findPouch(tx, input.pouchId, { lock: true });
			const deletesOnly = input.request.ops.every((op) => op.type === 'delete');
			assertCommitAllowed(pouch, principal, deletesOnly);
			if (pouch.epoch !== input.request.epoch)
				throw new AppError('epoch_mismatch', { epoch: pouch.epoch });

			const ids = [...new Set(input.request.ops.map((op) => op.artifact_id))].sort();
			const locked = await tx
				.select()
				.from(artifacts)
				.where(and(inArray(artifacts.id, ids), eq(artifacts.pouchId, pouch.id)))
				.orderBy(asc(artifacts.id))
				.for('update');

			const ctx: CommitContext = {
				tx,
				deps,
				principal,
				pouch,
				operationId: input.request.operation_id,
				origin: principal.kind === 'device' ? 'daemon' : 'web',
				members: await loadMembers(tx),
				artifactsById: new Map(locked.map((row) => [row.id, row])),
				envelopeBytesAdded: 0,
				now: deps.now(),
			};

			const results: OperationResult[] = [];
			for (const op of input.request.ops) {
				try {
					results.push(await applyOperation(ctx, op, signerMember));
				} catch (error) {
					if (!(error instanceof OperationRejected)) throw error;
					results.push({
						status: 'rejected',
						artifact_id: op.artifact_id,
						revision_id: op.revision_id,
						code: error.code,
						message: error.reason,
					});
				}
			}

			if (ctx.envelopeBytesAdded > 0) {
				const [account] = await tx
					.update(storageAccounts)
					.set({
						usedBytes: sql`${storageAccounts.usedBytes} + ${ctx.envelopeBytesAdded}`,
					})
					.where(eq(storageAccounts.id, principal.storageAccountId))
					.returning({
						used: storageAccounts.usedBytes,
						quota: storageAccounts.quotaBytes,
					});
				// Deletes always go through, even over quota: they are how users get back under it.
				if (account && account.used > account.quota && !deletesOnly) {
					throw new AppError('quota_exceeded', {
						quota_bytes: account.quota,
						used_bytes: account.used,
					});
				}
			}

			const [current] = await tx
				.select({ seq: pouches.eventSeq })
				.from(pouches)
				.where(eq(pouches.id, pouch.id));
			const body: CommitResponse = { results, high_water: current?.seq ?? pouch.eventSeq };
			const statuses = new Set(results.map((result) => result.status));
			await tx.insert(operationReceipts).values({
				storageAccountId: principal.storageAccountId,
				pouchId: pouch.id,
				operationId: input.request.operation_id,
				requestDigest: digest,
				status: statuses.size === 1 ? [...statuses][0]! : 'mixed',
				response: body,
				deviceId: principal.kind === 'device' ? principal.deviceId : null,
				deviceJkt: principal.kind === 'device' ? principal.jkt : null,
				deviceSignature: input.signature,
			});
			if (body.high_water > pouch.eventSeq) {
				await notifyPouch(tx, principal.storageAccountId, pouch.id, body.high_water);
			}
			return { replayed: false as const, body };
		},
		{ retries: 3 },
	);
	return response.body;
}

/** Validates one operation's structure; throws OperationRejected. */
async function validate(ctx: CommitContext, op: Operation, signerMember: string) {
	if (op.signer_member_id !== signerMember) {
		throw new OperationRejected(
			'member_inactive',
			'operations must be signed by the calling member',
		);
	}
	const signer = ctx.members.get(op.signer_member_id);
	if (!isActiveMember(signer))
		throw new OperationRejected('member_inactive', 'signer is not an active member');
	if (op.key_gen !== ctx.pouch.keyGen) {
		throw new OperationRejected(
			'key_gen_invalid',
			`new writes must use key generation ${ctx.pouch.keyGen}`,
		);
	}
	const envelope = Buffer.from(fromBase64Url(op.envelope));
	const header = parseSealedHeader(envelope);
	if (!header || header.keyGen !== op.key_gen || envelope.length > Limits.envelopeMaxBytes) {
		throw new OperationRejected(
			'envelope_invalid',
			'envelope is not a sealed v1 object of this generation',
		);
	}
	if (
		!verifyMemberSignature(
			signer.signPub,
			op.signature,
			CONTEXT.revision,
			revisionSignedMessage(ctx.pouch.id, op.revision_id, envelope),
		)
	) {
		throw new OperationRejected('signature_invalid', 'revision signature does not verify');
	}

	const blobIds = [...new Set(op.blob_ids)].map((id) => Buffer.from(fromBase64Url(id)));
	let storedSize = envelope.length;
	if (blobIds.length > 0) {
		const found = await ctx.tx
			.select({ blobId: blobs.blobId, size: blobs.storedSize })
			.from(blobs)
			.where(
				and(
					eq(blobs.pouchId, ctx.pouch.id),
					eq(blobs.state, 'stored'),
					inArray(blobs.blobId, blobIds),
				),
			);
		if (found.length !== blobIds.length) {
			throw new OperationRejected(
				'blob_missing',
				`${blobIds.length - found.length} referenced blob(s) not uploaded`,
			);
		}
		storedSize += found.reduce((sum, row) => sum + row.size, 0);
	}
	if (storedSize > Limits.revisionMaxStoredBytes)
		throw new OperationRejected('payload_too_large', 'revision too large');

	const [existingRevision] = await ctx.tx
		.select({ id: revisions.id })
		.from(revisions)
		.where(eq(revisions.id, op.revision_id));
	if (existingRevision)
		throw new OperationRejected('validation_failed', 'revision_id already used');

	if (['create', 'rename', 'restore'].includes(op.type) && !op.name_index) {
		throw new OperationRejected('validation_failed', `${op.type} requires name_index`);
	}
	if (op.type === 'create' && op.base_revision_id !== null) {
		throw new OperationRejected('validation_failed', 'create has no base revision');
	}
	if (op.type !== 'create' && op.base_revision_id === null) {
		throw new OperationRejected('validation_failed', `${op.type} requires base_revision_id`);
	}
	if (op.type === 'resolve' && !op.conflict_id)
		throw new OperationRejected('validation_failed', 'resolve requires conflict_id');
	return { envelope, blobIds, storedSize };
}

async function insertRevision(
	ctx: CommitContext,
	op: Operation,
	envelope: Buffer,
	blobIds: Buffer[],
	storedSize: number,
	_options: { headOf: boolean },
): Promise<void> {
	await ctx.tx.insert(revisions).values({
		id: op.revision_id,
		storageAccountId: ctx.principal.storageAccountId,
		pouchId: ctx.pouch.id,
		artifactId: op.artifact_id,
		parentId: op.base_revision_id,
		mergeParentId: op.merge_parent_id,
		envelope,
		envelopeHash: blake3Hash(envelope),
		signature: Buffer.from(fromBase64Url(op.signature)),
		signerMemberId: op.signer_member_id,
		keyGen: op.key_gen,
		storedSize,
		authorDeviceId: ctx.principal.kind === 'device' ? ctx.principal.deviceId : null,
		authorUserId: ctx.principal.userId,
		origin: op.type === 'resolve' ? 'resolve' : ctx.origin,
		// Conflict revisions are pinned (no expiry) until the conflict is resolved.
		expiresAt: null,
	});
	if (blobIds.length > 0) {
		await ctx.tx.insert(revisionBlobs).values(
			blobIds.map((blobId) => ({
				storageAccountId: ctx.principal.storageAccountId,
				pouchId: ctx.pouch.id,
				revisionId: op.revision_id,
				blobId,
			})),
		);
		await ctx.tx
			.update(blobs)
			.set({ refCount: sql`${blobs.refCount} + 1`, unreferencedSince: null })
			.where(and(eq(blobs.pouchId, ctx.pouch.id), inArray(blobs.blobId, blobIds)));
	}
	ctx.envelopeBytesAdded += envelope.length;
}

async function liveArtifactWithName(ctx: CommitContext, nameIndex: Buffer, exceptId: string) {
	const [row] = await ctx.tx
		.select()
		.from(artifacts)
		.where(
			and(
				eq(artifacts.pouchId, ctx.pouch.id),
				eq(artifacts.nameIndex, nameIndex),
				isNull(artifacts.deletedAt),
				ne(artifacts.id, exceptId),
			),
		);
	return row;
}

async function recordConflict(
	ctx: CommitContext,
	op: Operation,
	type: ConflictType,
	artifactId: string,
	serverRevisionId: string | null,
): Promise<OperationResult> {
	const conflictId = randomUUID();
	await ctx.tx.insert(conflicts).values({
		id: conflictId,
		storageAccountId: ctx.principal.storageAccountId,
		pouchId: ctx.pouch.id,
		artifactId,
		type,
		baseRevisionId: op.base_revision_id,
		serverRevisionId,
		incomingRevisionId: op.revision_id,
		deviceId: ctx.principal.kind === 'device' ? ctx.principal.deviceId : null,
	});
	const seq = await appendEvent(ctx.tx, {
		storageAccountId: ctx.principal.storageAccountId,
		pouchId: ctx.pouch.id,
		epoch: ctx.pouch.epoch,
		type: 'conflict.opened',
		artifactId,
		revisionId: op.revision_id,
		operationId: ctx.operationId,
		deviceId: ctx.principal.kind === 'device' ? ctx.principal.deviceId : null,
		payload: { conflict_id: conflictId, conflict_type: type },
	});
	return {
		status: 'conflict',
		artifact_id: artifactId,
		revision_id: op.revision_id,
		conflict_id: conflictId,
		conflict_type: type as 'update_update' | 'edit_delete' | 'delete_edit' | 'name_collision',
		server_revision_id: serverRevisionId,
		seq,
	};
}

async function applyOperation(
	ctx: CommitContext,
	op: Operation,
	signerMember: string,
): Promise<OperationResult> {
	const { envelope, blobIds, storedSize } = await validate(ctx, op, signerMember);
	const nameIndex = op.name_index ? Buffer.from(fromBase64Url(op.name_index)) : null;
	const deviceId = ctx.principal.kind === 'device' ? ctx.principal.deviceId : null;

	if (op.type === 'create') {
		const [taken] = await ctx.tx
			.select({ id: artifacts.id })
			.from(artifacts)
			.where(eq(artifacts.id, op.artifact_id));
		if (taken) throw new OperationRejected('validation_failed', 'artifact_id already exists');
		const collision = await liveArtifactWithName(ctx, nameIndex!, op.artifact_id);
		// The incoming artifact always lands; on a name collision it stays non-live until resolved.
		await ctx.tx.insert(artifacts).values({
			id: op.artifact_id,
			storageAccountId: ctx.principal.storageAccountId,
			pouchId: ctx.pouch.id,
			nameIndex: nameIndex!,
			deletedAt: collision ? ctx.now : null,
		});
		await insertRevision(ctx, op, envelope, blobIds, storedSize, { headOf: true });
		await ctx.tx
			.update(artifacts)
			.set({ headRevisionId: op.revision_id })
			.where(eq(artifacts.id, op.artifact_id));
		if (collision)
			return recordConflict(
				ctx,
				op,
				'name_collision',
				op.artifact_id,
				collision.headRevisionId,
			);
		return applied(ctx, op, deviceId);
	}

	const artifact = ctx.artifactsById.get(op.artifact_id);
	if (!artifact) throw new OperationRejected('not_found', 'artifact not found in this pouch');

	// Stale base → conflict; the incoming revision is kept but does not become head.
	const baseIsHead = op.base_revision_id === artifact.headRevisionId;
	if (artifact.deletedAt !== null && baseIsHead && op.type === 'delete') {
		throw new OperationRejected('validation_failed', 'artifact is already deleted');
	}
	const editsTombstone =
		artifact.deletedAt !== null && (op.type === 'update' || op.type === 'rename');
	if (!baseIsHead || editsTombstone) {
		await insertRevision(ctx, op, envelope, blobIds, storedSize, { headOf: false });
		const type: ConflictType =
			op.type === 'delete'
				? 'delete_edit'
				: artifact.deletedAt !== null
					? 'edit_delete'
					: 'update_update';
		return recordConflict(ctx, op, type, artifact.id, artifact.headRevisionId);
	}

	let deletedAt = artifact.deletedAt;
	let newNameIndex = artifact.nameIndex;
	if (op.type === 'delete') deletedAt = ctx.now;
	if (op.type === 'restore') {
		if (artifact.deletedAt === null)
			throw new OperationRejected('validation_failed', 'artifact is not deleted');
		deletedAt = null;
	}
	// A resolve that names the artifact makes it live (e.g. ends a name collision).
	if (op.type === 'resolve' && nameIndex) deletedAt = null;
	if (nameIndex && (op.type === 'rename' || op.type === 'restore' || op.type === 'resolve'))
		newNameIndex = nameIndex;
	if (
		deletedAt === null &&
		(op.type === 'rename' || op.type === 'restore' || op.type === 'resolve')
	) {
		if (await liveArtifactWithName(ctx, newNameIndex, artifact.id)) {
			await insertRevision(ctx, op, envelope, blobIds, storedSize, { headOf: false });
			return recordConflict(ctx, op, 'name_collision', artifact.id, artifact.headRevisionId);
		}
	}

	if (op.type === 'resolve') {
		const [conflict] = await ctx.tx
			.select()
			.from(conflicts)
			.where(
				and(
					eq(conflicts.id, op.conflict_id!),
					eq(conflicts.artifactId, artifact.id),
					eq(conflicts.state, 'open'),
				),
			)
			.for('update');
		if (!conflict)
			throw new OperationRejected(
				'not_found',
				'no open conflict with this id for this artifact',
			);
		await ctx.tx
			.update(conflicts)
			.set({
				state: 'resolved',
				resolution: op.merge_parent_id ? 'merged' : 'resolved',
				resolvedBy: ctx.principal.userId,
				resolvedAt: ctx.now,
			})
			.where(eq(conflicts.id, conflict.id));
		// Its pinned revisions now follow normal retention.
		const retained = new Date(ctx.now.getTime() + Limits.revisionRetentionDays * 86400_000);
		const pinned = [conflict.incomingRevisionId, conflict.serverRevisionId].filter(
			(id): id is string => id !== null,
		);
		if (pinned.length > 0) {
			await ctx.tx
				.update(revisions)
				.set({ expiresAt: retained })
				.where(and(inArray(revisions.id, pinned), ne(revisions.id, op.revision_id)));
		}
	}

	await insertRevision(ctx, op, envelope, blobIds, storedSize, { headOf: true });
	if (artifact.headRevisionId) {
		await ctx.tx
			.update(revisions)
			.set({
				expiresAt: new Date(ctx.now.getTime() + Limits.revisionRetentionDays * 86400_000),
			})
			.where(
				and(
					eq(revisions.id, artifact.headRevisionId),
					isNull(revisions.expiresAt),
					notPinnedByConflict(artifact.headRevisionId),
				),
			);
	}
	await ctx.tx
		.update(artifacts)
		.set({
			headRevisionId: op.revision_id,
			deletedAt,
			nameIndex: newNameIndex,
			updatedAt: ctx.now,
		})
		.where(eq(artifacts.id, artifact.id));
	ctx.artifactsById.set(artifact.id, {
		...artifact,
		headRevisionId: op.revision_id,
		deletedAt,
		nameIndex: newNameIndex,
	});

	if (op.type === 'resolve') {
		await appendEvent(ctx.tx, {
			storageAccountId: ctx.principal.storageAccountId,
			pouchId: ctx.pouch.id,
			epoch: ctx.pouch.epoch,
			type: 'conflict.resolved',
			artifactId: artifact.id,
			revisionId: op.revision_id,
			operationId: ctx.operationId,
			deviceId,
			payload: { conflict_id: op.conflict_id },
		});
	}
	return applied(ctx, op, deviceId);
}

/** A revision stays pinned while an open conflict references it. */
function notPinnedByConflict(revisionId: string) {
	return sql`NOT EXISTS (SELECT 1 FROM conflicts c WHERE c.state = 'open' AND (c.server_revision_id = ${revisionId} OR c.incoming_revision_id = ${revisionId} OR c.base_revision_id = ${revisionId}))`;
}

async function applied(
	ctx: CommitContext,
	op: Operation,
	deviceId: string | null,
): Promise<OperationResult> {
	const seq = await appendEvent(ctx.tx, {
		storageAccountId: ctx.principal.storageAccountId,
		pouchId: ctx.pouch.id,
		epoch: ctx.pouch.epoch,
		type: EVENT_FOR[op.type],
		artifactId: op.artifact_id,
		revisionId: op.revision_id,
		operationId: ctx.operationId,
		deviceId,
	});
	return { status: 'applied', artifact_id: op.artifact_id, revision_id: op.revision_id, seq };
}
