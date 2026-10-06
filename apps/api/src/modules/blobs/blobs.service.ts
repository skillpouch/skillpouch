// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Encrypted blob storage (plan 04 §3.2, 06 §6, 09 §2–3).
 *
 *   check → reserve quota for missing blobs (`pending`), reject over quota
 *           before any byte is uploaded;
 *   put   → verify BLAKE3(body) == Skillpouch-Ciphertext-Hash and the sealed
 *           header, store atomically, move bytes from pending to used.
 *
 * Blob IDs are keyed per pouch (15 §5.1): the server cannot link equal
 * content across pouches or users.
 */
import { Limits, fromBase64Url, parseSealedHeader, toBase64Url } from '@skillpouch/contracts';
import { blobs, storageAccounts } from '@skillpouch/db';
import { and, eq, inArray, sql } from 'drizzle-orm';
import type { Deps } from '../../deps';
import { AppError } from '../../http/app-error';
import { TenantBlobStore } from '../../infra/blob-store/tenant-blob-store';
import { blake3Hash } from '../../security/crypto-util';
import type { Principal } from '../../security/principal';
import { withTenantTx, type TenantTx } from '../../security/tenant-tx';
import { findPouch, findWritablePouch } from '../pouches/pouches.service';

export function blobIdBytes(id: string): Buffer {
	const bytes = Buffer.from(fromBase64Url(id));
	if (bytes.length !== 32)
		throw new AppError('validation_failed', { reason: 'blob id must be 32 bytes' });
	return bytes;
}

async function lockAccount(tx: TenantTx, storageAccountId: string) {
	const [account] = await tx
		.select()
		.from(storageAccounts)
		.where(eq(storageAccounts.id, storageAccountId))
		.for('update');
	if (!account) throw new AppError('not_found');
	return account;
}

/** Returns the blob IDs the client must upload and reserves their bytes. */
export async function checkBlobs(
	deps: Deps,
	principal: Principal,
	pouchId: string,
	items: { id: string; stored_size: number }[],
) {
	return withTenantTx(deps.db.app, principal.storageAccountId, async (tx) => {
		await findWritablePouch(tx, pouchId);
		const unique = new Map(items.map((item) => [item.id, item]));
		const ids = [...unique.keys()].map(blobIdBytes);
		const existing = await tx
			.select({ blobId: blobs.blobId, state: blobs.state })
			.from(blobs)
			.where(and(eq(blobs.pouchId, pouchId), inArray(blobs.blobId, ids)));
		const known = new Map(existing.map((row) => [toBase64Url(row.blobId), row.state]));
		const missing = [...unique.keys()].filter((id) => known.get(id) !== 'stored');
		const toReserve = missing.filter((id) => !known.has(id));
		const reserveBytes = toReserve.reduce((sum, id) => sum + unique.get(id)!.stored_size, 0);

		if (toReserve.length > 0) {
			const account = await lockAccount(tx, principal.storageAccountId);
			if (account.usedBytes + account.pendingBytes + reserveBytes > account.quotaBytes) {
				throw new AppError('quota_exceeded', {
					quota_bytes: account.quotaBytes,
					used_bytes: account.usedBytes,
					requested_bytes: reserveBytes,
				});
			}
			await tx
				.insert(blobs)
				.values(
					toReserve.map((id) => ({
						storageAccountId: principal.storageAccountId,
						pouchId,
						blobId: blobIdBytes(id),
						storedSize: unique.get(id)!.stored_size,
						state: 'pending' as const,
					})),
				)
				.onConflictDoNothing();
			await tx
				.update(storageAccounts)
				.set({ pendingBytes: sql`${storageAccounts.pendingBytes} + ${reserveBytes}` })
				.where(eq(storageAccounts.id, principal.storageAccountId));
		}
		return { missing };
	});
}

/** Stores one uploaded blob. Idempotent: re-uploading a stored blob is a no-op. */
export async function putBlob(
	deps: Deps,
	principal: Principal,
	pouchId: string,
	blobIdText: string,
	body: Buffer,
	ciphertextHashText: string | undefined,
): Promise<{ blob_id: string; stored_size: number }> {
	const blobId = blobIdBytes(blobIdText);
	if (!ciphertextHashText)
		throw new AppError('validation_failed', {
			reason: 'Skillpouch-Ciphertext-Hash header required',
		});
	const expectedHash = Buffer.from(fromBase64Url(ciphertextHashText));
	if (body.length > Limits.blobMaxStoredBytes)
		throw new AppError('blob_too_large', { max: Limits.blobMaxStoredBytes });
	if (!blake3Hash(body).equals(expectedHash)) throw new AppError('ciphertext_hash_mismatch');
	const header = parseSealedHeader(body);
	if (!header)
		throw new AppError('envelope_invalid', { reason: 'blob is not a sealed v1 object' });

	// Validate the pouch before touching the disk.
	const pouch = await withTenantTx(deps.db.app, principal.storageAccountId, (tx) =>
		findWritablePouch(tx, pouchId),
	);
	if (header.keyGen > pouch.keyGen) throw new AppError('key_gen_invalid');

	const store = new TenantBlobStore(deps.blobs, principal.storageAccountId, pouchId);
	await store.put(blobId, body);

	await withTenantTx(deps.db.app, principal.storageAccountId, async (tx) => {
		const [row] = await tx
			.select()
			.from(blobs)
			.where(and(eq(blobs.pouchId, pouchId), eq(blobs.blobId, blobId)))
			.for('update');
		if (row?.state === 'stored') return;
		const account = await lockAccount(tx, principal.storageAccountId);
		const reserved = row?.state === 'pending' ? row.storedSize : 0;
		if (!row && account.usedBytes + account.pendingBytes + body.length > account.quotaBytes) {
			throw new AppError('quota_exceeded', {
				quota_bytes: account.quotaBytes,
				used_bytes: account.usedBytes,
			});
		}
		if (row) {
			await tx
				.update(blobs)
				.set({
					state: 'stored',
					storedSize: body.length,
					ciphertextHash: expectedHash,
					keyGen: header.keyGen,
					unreferencedSince: row.refCount === 0 ? deps.now() : null,
				})
				.where(and(eq(blobs.pouchId, pouchId), eq(blobs.blobId, blobId)));
		} else {
			await tx.insert(blobs).values({
				storageAccountId: principal.storageAccountId,
				pouchId,
				blobId,
				ciphertextHash: expectedHash,
				storedSize: body.length,
				keyGen: header.keyGen,
				state: 'stored',
				unreferencedSince: deps.now(),
			});
		}
		await tx
			.update(storageAccounts)
			.set({
				usedBytes: sql`${storageAccounts.usedBytes} + ${body.length}`,
				pendingBytes: sql`GREATEST(0, ${storageAccounts.pendingBytes} - ${reserved})`,
			})
			.where(eq(storageAccounts.id, principal.storageAccountId));
	});
	return { blob_id: blobIdText, stored_size: body.length };
}

/** Reads one stored blob (ciphertext) of a pouch. */
export async function getBlob(
	deps: Deps,
	principal: Principal,
	pouchId: string,
	blobIdText: string,
) {
	const blobId = blobIdBytes(blobIdText);
	const row = await withTenantTx(deps.db.app, principal.storageAccountId, async (tx) => {
		await findPouch(tx, pouchId);
		const [found] = await tx
			.select()
			.from(blobs)
			.where(
				and(
					eq(blobs.pouchId, pouchId),
					eq(blobs.blobId, blobId),
					eq(blobs.state, 'stored'),
				),
			);
		return found;
	});
	if (!row) throw new AppError('not_found');
	const bytes = await new TenantBlobStore(deps.blobs, principal.storageAccountId, pouchId).get(
		blobId,
	);
	if (!bytes) throw new AppError('not_found');
	return { bytes, ciphertextHash: row.ciphertextHash ? toBase64Url(row.ciphertextHash) : null };
}

/**
 * Batch framing (16 §10). Upload frames: `id(32) ‖ ciphertext_hash(32) ‖ u32_be len ‖ bytes`;
 * download frames: `id(32) ‖ u32_be len ‖ bytes`.
 */
export function parseUploadFrames(body: Buffer): { id: Buffer; hash: Buffer; bytes: Buffer }[] {
	const frames: { id: Buffer; hash: Buffer; bytes: Buffer }[] = [];
	let offset = 0;
	while (offset < body.length) {
		if (body.length - offset < 68)
			throw new AppError('validation_failed', { reason: 'truncated frame' });
		const id = body.subarray(offset, offset + 32);
		const hash = body.subarray(offset + 32, offset + 64);
		const length = body.readUInt32BE(offset + 64);
		offset += 68;
		if (length > Limits.blobMaxStoredBytes || offset + length > body.length) {
			throw new AppError('validation_failed', { reason: 'bad frame length' });
		}
		frames.push({ id, hash, bytes: body.subarray(offset, offset + length) });
		offset += length;
		if (frames.length > Limits.blobBatchMaxParts) throw new AppError('payload_too_large');
	}
	return frames;
}

export function encodeDownloadFrames(items: { id: Buffer; bytes: Buffer }[]): Buffer {
	const parts: Buffer[] = [];
	for (const item of items) {
		const length = Buffer.alloc(4);
		length.writeUInt32BE(item.bytes.length);
		parts.push(item.id, length, item.bytes);
	}
	return Buffer.concat(parts);
}
