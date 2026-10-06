// SPDX-License-Identifier: AGPL-3.0-only
/**
 * File contents ("blobs").
 *
 *   blob_id         = BLAKE3.keyed_hash(K_blob_id, plaintext)
 *   stored_object   = seal(K_content_g, plaintext, aad = "skillpouch/v1/blob" ‖ pouch_id ‖ blob_id)
 *   ciphertext_hash = BLAKE3(stored_object)     (the server verifies uploads with it)
 *
 * On download the reader checks the AEAD tag and then recomputes the keyed
 * id: a mismatch means corruption or tampering.
 */
import { blake3 } from '@noble/hashes/blake3.js';
import { b64, bytesEqual, concat, unb64 } from './bytes';
import { CryptoError } from './errors';
import { blobId, generation, type PouchKeys } from './pouch-keys';
import { open, seal, sealedKeyGen } from './sealed';

export interface SealedBlob {
	id: string;
	bytes: Uint8Array;
	/** base64url BLAKE3 of `bytes` — the `Skillpouch-Ciphertext-Hash` header. */
	hash: string;
	/** Plaintext size, recorded in the manifest. */
	size: number;
}

const blobAad = (pouchId: string, id: string) => concat('skillpouch/v1/blob', pouchId, unb64(id));

export function sealBlob(keys: PouchKeys, plaintext: Uint8Array): SealedBlob {
	const id = blobId(keys, plaintext);
	const bytes = seal(
		keys.current.content,
		keys.current.keyGen,
		plaintext,
		blobAad(keys.pouchId, id),
	);
	return { id, bytes, hash: b64(blake3(bytes)), size: plaintext.length };
}

export function openBlob(keys: PouchKeys, id: string, stored: Uint8Array): Uint8Array {
	const gen = generation(keys, sealedKeyGen(stored));
	const plaintext = open(gen.content, stored, blobAad(keys.pouchId, id));
	if (!bytesEqual(unb64(blobId(keys, plaintext)), unb64(id))) {
		throw new CryptoError('blob_id_mismatch', 'blob content does not match its id');
	}
	return plaintext;
}

/** Frames for `POST /blobs/batch`: `id(32) ‖ hash(32) ‖ u32_be(len) ‖ bytes`, repeated. */
export function frameBatch(blobs: SealedBlob[]): Uint8Array {
	const parts: Uint8Array[] = [];
	for (const blob of blobs) {
		const length = new Uint8Array(4);
		new DataView(length.buffer).setUint32(0, blob.bytes.length, false);
		parts.push(unb64(blob.id), unb64(blob.hash), length, blob.bytes);
	}
	return concat(...parts);
}

/** Parses the `POST /blobs/fetch` response: `id(32) ‖ u32_be(len) ‖ bytes`, repeated. */
export function parseFetched(body: Uint8Array): Map<string, Uint8Array> {
	const out = new Map<string, Uint8Array>();
	const view = new DataView(body.buffer, body.byteOffset, body.byteLength);
	let offset = 0;
	while (offset < body.length) {
		if (offset + 36 > body.length)
			throw new CryptoError('format_unsupported', 'truncated blob frame');
		const id = b64(body.subarray(offset, offset + 32));
		const length = view.getUint32(offset + 32, false);
		const start = offset + 36;
		if (start + length > body.length)
			throw new CryptoError('format_unsupported', 'truncated blob');
		out.set(id, body.slice(start, start + length));
		offset = start + length;
	}
	return out;
}
