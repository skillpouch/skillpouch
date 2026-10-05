// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The only way routes reach blobs (plan 06 §2.1): keys are always built from
 * the principal's storage account and an already-authorized pouch.
 */
import { toHex } from '@skillpouch/contracts';
import type { BlobStore } from './blob-store';

export class TenantBlobStore {
	constructor(
		private readonly store: BlobStore,
		private readonly storageAccountId: string,
		private readonly pouchId: string,
	) {}

	private key(blobId: Uint8Array) {
		return { storageAccountId: this.storageAccountId, pouchId: this.pouchId, blobIdHex: toHex(blobId) };
	}

	put(blobId: Uint8Array, body: Uint8Array) {
		return this.store.put(this.key(blobId), body);
	}

	get(blobId: Uint8Array) {
		return this.store.get(this.key(blobId));
	}

	has(blobId: Uint8Array) {
		return this.store.has(this.key(blobId));
	}
}
