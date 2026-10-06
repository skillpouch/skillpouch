// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Sync-side client behaviour for tests: upload sealed blobs, build
 * signed operations, and commit them — CLI devices additionally send the
 * detached `Skillpouch-Signature` over the canonical request digest.
 */
import { randomBytes } from 'node:crypto';
import { blake3 } from '@noble/hashes/blake3.js';
import { canonicalDigest, toBase64Url } from '@skillpouch/contracts';
import { CompactSign } from 'jose';
import { uuidv7 } from '../../src/lib/ids';
import { CliClient, type ApiResponse, type BaseClient } from './clients';
import { b64, randomBlobId, sealed } from './e2ee';
import type { TestKey } from './keys';

export type OpType = 'create' | 'update' | 'rename' | 'delete' | 'restore' | 'resolve';

export interface OpInput {
	type: OpType;
	artifactId: string;
	baseRevisionId: string | null;
	keyGen?: number;
	nameIndex?: string | null;
	mergeParentId?: string | null;
	conflictId?: string | null;
	blobIds?: string[];
	/** Override the revision id (negative tests). */
	revisionId?: string;
	/** Sign with this key instead of the member key (forgery tests). */
	signWith?: TestKey;
}

export interface Writer {
	client: BaseClient;
	memberId: string;
	key: TestKey;
}

/** A random blind name index (keyed HMAC in real clients). */
export function nameIndex(): string {
	return b64(randomBytes(32));
}

/** Builds one signed operation exactly as the client does. */
export async function buildOp(writer: Writer, pouchId: string, input: OpInput) {
	const revisionId = input.revisionId ?? uuidv7();
	const keyGen = input.keyGen ?? 1;
	const envelope = sealed(keyGen, 200);
	const message = Buffer.concat([
		Buffer.from(pouchId),
		Buffer.from(revisionId),
		Buffer.from(blake3(envelope)),
	]);
	const signature = await (input.signWith ?? writer.key).sign(
		'skillpouch/v1/revision-sig',
		message,
	);
	return {
		type: input.type,
		artifact_id: input.artifactId,
		revision_id: revisionId,
		base_revision_id: input.baseRevisionId,
		merge_parent_id: input.mergeParentId ?? null,
		name_index: input.nameIndex ?? null,
		conflict_id: input.conflictId ?? null,
		key_gen: keyGen,
		envelope: b64(envelope),
		signature,
		signer_member_id: writer.memberId,
		blob_ids: input.blobIds ?? [],
	};
}

/** Detached compact JWS (`header..signature`) over base64url(BLAKE3(canonical body)). */
export async function requestSignature(key: TestKey, body: unknown): Promise<string> {
	const jws = await new CompactSign(canonicalDigest(body))
		.setProtectedHeader({ alg: 'ES256' })
		.sign(key.privateKey);
	const [header, , signature] = jws.split('.');
	return `${header}..${signature}`;
}

export async function commit(
	writer: Writer,
	pouchId: string,
	epoch: string,
	ops: Awaited<ReturnType<typeof buildOp>>[],
	options: { operationId?: string; noSignature?: boolean } = {},
): Promise<ApiResponse> {
	const body = { operation_id: options.operationId ?? uuidv7(), epoch, ops };
	const headers: Record<string, string> = {};
	if (writer.client instanceof CliClient && !options.noSignature) {
		headers['skillpouch-signature'] = await requestSignature(writer.key, body);
	}
	return writer.client.post(`/v1/pouches/${pouchId}/operations`, body, { headers });
}

/** Convenience: commit one op and return its result (throws on HTTP error). */
export async function commitOne(writer: Writer, pouchId: string, epoch: string, input: OpInput) {
	const op = await buildOp(writer, pouchId, input);
	const response = await commit(writer, pouchId, epoch, [op]);
	if (response.status !== 200) throw new Error(`commit failed: ${JSON.stringify(response.body)}`);
	return response.body.data.results[0];
}

export interface UploadedBlob {
	id: string;
	bytes: Buffer;
}

/** `blobs/check` then one PUT per missing blob. */
export async function uploadBlobs(
	client: BaseClient,
	pouchId: string,
	count = 1,
	keyGen = 1,
): Promise<UploadedBlob[]> {
	const items = Array.from({ length: count }, () => ({
		id: randomBlobId(),
		bytes: sealed(keyGen, 300),
	}));
	const check = await client.post(`/v1/pouches/${pouchId}/blobs/check`, {
		blobs: items.map((item) => ({ id: item.id, stored_size: item.bytes.length })),
	});
	if (check.status !== 200) throw new Error(`check failed: ${JSON.stringify(check.body)}`);
	for (const item of items) {
		const put = await client.request('PUT', `/v1/pouches/${pouchId}/blobs/${item.id}`, {
			rawBody: item.bytes,
			headers: { 'skillpouch-ciphertext-hash': toBase64Url(blake3(item.bytes)) },
		});
		if (put.status !== 200) throw new Error(`put failed: ${JSON.stringify(put.body)}`);
	}
	return items;
}

export async function pouchState(client: BaseClient, pouchId: string) {
	const response = await client.get(`/v1/pouches/${pouchId}`);
	return response.body.data as {
		id: string;
		epoch: string;
		event_seq: number;
		key_gen: number;
		state: string;
	};
}
