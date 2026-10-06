// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Storage for client-encrypted blobs. The API never
 * decrypts; it stores and serves opaque ciphertext. Routes never use a
 * BlobStore directly — only `TenantBlobStore`, which builds tenant keys.
 */
export interface BlobKey {
	storageAccountId: string;
	pouchId: string;
	/** Hex of the 32-byte keyed BLAKE3 blob id. */
	blobIdHex: string;
}

export interface BlobStore {
	/** Stores bytes atomically. Never overwrites an existing object. */
	put(key: BlobKey, body: Uint8Array): Promise<void>;
	/** Returns the bytes, or null when the object does not exist. */
	get(key: BlobKey): Promise<Buffer | null>;
	has(key: BlobKey): Promise<boolean>;
	delete(key: BlobKey): Promise<void>;
	/** Deletes every object of a pouch (pouch purge). */
	deletePouch(storageAccountId: string, pouchId: string): Promise<void>;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const HEX64 = /^[0-9a-f]{64}$/;

/** Validates a key so it can never escape its tenant prefix. */
export function assertValidKey(key: BlobKey): void {
	if (!UUID.test(key.storageAccountId) || !UUID.test(key.pouchId) || !HEX64.test(key.blobIdHex)) {
		throw new Error('invalid blob key');
	}
}
