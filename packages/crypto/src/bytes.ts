// SPDX-License-Identifier: AGPL-3.0-only
/** Small byte helpers used by every format in this package. */
import { blake3 } from '@noble/hashes/blake3.js';
import { fromBase64Url, toBase64Url } from '@skillpouch/contracts';

export { bytesEqual, fromBase64Url as fromB64, toBase64Url as toB64 } from '@skillpouch/contracts';

const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });

export const utf8 = (text: string): Uint8Array => encoder.encode(text);
export const fromUtf8 = (bytes: Uint8Array): string => decoder.decode(bytes);

/** Plain BLAKE3 (32 bytes): roster statement hashes, ciphertext hashes. */
export const blake3Hash = (bytes: Uint8Array): Uint8Array => blake3(bytes);

/** Concatenates byte arrays; strings are UTF-8 encoded. */
export function concat(...parts: (Uint8Array | string)[]): Uint8Array {
	const chunks = parts.map((part) => (typeof part === 'string' ? utf8(part) : part));
	const out = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.length, 0));
	let offset = 0;
	for (const chunk of chunks) {
		out.set(chunk, offset);
		offset += chunk.length;
	}
	return out;
}

export function u32be(value: number): Uint8Array {
	const out = new Uint8Array(4);
	new DataView(out.buffer).setUint32(0, value, false);
	return out;
}

export function readU32be(bytes: Uint8Array, offset: number): number {
	return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(offset, false);
}

export function randomBytes(length: number): Uint8Array {
	const out = new Uint8Array(length);
	globalThis.crypto.getRandomValues(out);
	return out;
}

/** Overwrites secret material that is no longer needed. */
export function wipe(...buffers: (Uint8Array | undefined)[]): void {
	for (const buffer of buffers) buffer?.fill(0);
}

/** A copy whose `ArrayBuffer` is exactly the view — what WebCrypto wants. */
export function exact(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
	const out = new Uint8Array(bytes.length);
	out.set(bytes);
	return out;
}

export const b64 = toBase64Url;
export const unb64 = fromBase64Url;
