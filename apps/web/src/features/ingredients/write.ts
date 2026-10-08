// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Writing to a pouch from the browser, the same way the CLI does:
 *
 *   1. seal every file → content-addressed blob ids (keyed, so equal files in
 *      other pouches don't link up);
 *   2. `blobs/check` reserves quota and says which blobs are new; upload those
 *      in framed batches;
 *   3. seal + sign the revision envelope and commit one operation with the
 *      revision we started from as precondition.
 *
 * A stale base never overwrites anything: the server records a conflict and
 * keeps both versions.
 */
import {
	frameBatch,
	nameIndex,
	pouchKeys,
	sealBlob,
	sealRevision,
	type Keyring,
	type ManifestEntry,
	type RevisionBody,
	type SealedBlob,
} from '@skillpouch/crypto';
import { Limits } from '@skillpouch/contracts';
import { api } from '@/lib/api/client';
import type { OperationResultRecord, PouchRecord } from '@/lib/api/types';
import type { ProjectKind } from '../projects/scope';
import type { Ingredient } from './ingredients';
import type { IngredientKind } from './kinds';

export interface DraftFile {
	path: string;
	bytes: Uint8Array;
	mode?: 'file' | 'exec';
}

export type OperationType = 'create' | 'update' | 'rename' | 'delete' | 'restore' | 'resolve';

export class CommitConflictError extends Error {
	constructor(readonly result: Extract<OperationResultRecord, { status: 'conflict' }>) {
		super(
			result.conflict_type === 'name_collision'
				? 'An item with this name already exists in this pouch.'
				: 'Someone changed this item at the same time. Both versions were kept.',
		);
		this.name = 'CommitConflictError';
	}
}

export class CommitRejectedError extends Error {
	constructor(readonly result: Extract<OperationResultRecord, { status: 'rejected' }>) {
		super(result.message);
		this.name = 'CommitRejectedError';
	}
}

async function uploadBlobs(pouchId: string, blobs: SealedBlob[]): Promise<void> {
	const unique = [...new Map(blobs.map((blob) => [blob.id, blob])).values()];
	if (unique.length === 0) return;
	const missing = new Set<string>();
	for (let start = 0; start < unique.length; start += Limits.blobCheckMax) {
		const slice = unique.slice(start, start + Limits.blobCheckMax);
		const { missing: ids } = await api.post<{ missing: string[] }>(
			`/v1/pouches/${pouchId}/blobs/check`,
			{ blobs: slice.map((blob) => ({ id: blob.id, stored_size: blob.bytes.length })) },
		);
		for (const id of ids) missing.add(id);
	}
	let batch: SealedBlob[] = [];
	let batchBytes = 0;
	const flush = async () => {
		if (batch.length === 0) return;
		await api.bytes('POST', `/v1/pouches/${pouchId}/blobs/batch`, { bytes: frameBatch(batch) });
		batch = [];
		batchBytes = 0;
	};
	for (const blob of unique) {
		if (!missing.has(blob.id)) continue;
		const size = blob.bytes.length + 68;
		if (
			batch.length === Limits.blobBatchMaxParts ||
			batchBytes + size > Limits.blobBatchMaxBytes
		) {
			await flush();
		}
		batch.push(blob);
		batchBytes += size;
	}
	await flush();
}

export interface CommitInput {
	keyring: Keyring;
	pouch: Pick<PouchRecord, 'id' | 'epoch'>;
	type: OperationType;
	artifactId: string;
	base: Pick<Ingredient, 'revisionId'> | null;
	kind: IngredientKind | ProjectKind;
	scope?: string;
	name: string;
	/** New content; omitted for delete/restore, which keep the previous entries. */
	files?: DraftFile[];
	previousEntries?: ManifestEntry[];
	mergeParentId?: string | null;
	conflictId?: string | null;
}

/** Seals, uploads and commits one operation; returns the applied revision id. */
export async function commitIngredient(input: CommitInput): Promise<{ revisionId: string }> {
	const keys = pouchKeys(input.keyring, input.pouch.id);
	const scope = input.scope ?? 'global';
	const revisionId = crypto.randomUUID();

	let entries: ManifestEntry[] = input.previousEntries ?? [];
	let sealed: SealedBlob[] = [];
	if (input.files) {
		sealed = input.files.map((file) => sealBlob(keys, file.bytes));
		entries = input.files.map((file, index) => ({
			path: file.path,
			blob: sealed[index]!.id,
			size: file.bytes.length,
			mode: file.mode ?? 'file',
		}));
		await uploadBlobs(input.pouch.id, sealed);
	}

	const body: RevisionBody = {
		format: 1,
		artifact_id: input.artifactId,
		revision_id: revisionId,
		parent_id: input.base?.revisionId ?? null,
		merge_parent_id: input.mergeParentId ?? null,
		kind: input.kind,
		scope,
		logical_key: input.name,
		deleted: input.type === 'delete',
		entries,
		roster_head: input.keyring.roster.headHash,
		author_member_id: input.keyring.member.id,
		created_at: new Date().toISOString(),
	};
	const revision = await sealRevision(keys, input.keyring.member.keys, body);
	const namesItself = ['create', 'rename', 'restore', 'resolve'].includes(input.type);
	const operation = {
		type: input.type,
		artifact_id: input.artifactId,
		revision_id: revisionId,
		base_revision_id: input.base?.revisionId ?? null,
		merge_parent_id: input.mergeParentId ?? null,
		name_index: namesItself ? nameIndex(keys, input.kind, scope, input.name) : null,
		conflict_id: input.conflictId ?? null,
		key_gen: revision.keyGen,
		envelope: revision.envelope,
		signature: revision.signature,
		signer_member_id: input.keyring.member.id,
		blob_ids: [...new Set(entries.map((entry) => entry.blob))],
	};
	const { results } = await api.post<{ results: OperationResultRecord[] }>(
		`/v1/pouches/${input.pouch.id}/operations`,
		{ operation_id: crypto.randomUUID(), epoch: input.pouch.epoch, ops: [operation] },
	);
	const result = results[0]!;
	if (result.status === 'conflict') throw new CommitConflictError(result);
	if (result.status === 'rejected') throw new CommitRejectedError(result);
	return { revisionId };
}

const encoder = new TextEncoder();

export function textFile(path: string, text: string): DraftFile {
	return { path, bytes: encoder.encode(text) };
}
