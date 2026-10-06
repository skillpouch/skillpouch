// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Padmé padding: plaintext lengths are rounded up so ciphertext sizes only
 * leak a coarse bucket (≤ 12 % overhead). Layout:
 *
 *   padded = plaintext ‖ 0x80 ‖ 0x00 … 0x00      (total length = padme(len + 1))
 *
 * Unpadding strips the zero run and the 0x80 marker; anything else is a
 * format error.
 */
import { CryptoError } from './errors';

/** Padmé length for `length` bytes (Nikitin et al., "Reducing Metadata Leakage from Encrypted Files"). */
export function padmeLength(length: number): number {
	if (length < 2) return length;
	const e = Math.floor(Math.log2(length));
	const s = Math.floor(Math.log2(e)) + 1;
	const lastBits = e - s;
	const mask = 2 ** lastBits - 1;
	return Math.floor((length + mask) / 2 ** lastBits) * 2 ** lastBits;
}

export function pad(plaintext: Uint8Array): Uint8Array {
	const out = new Uint8Array(padmeLength(plaintext.length + 1));
	out.set(plaintext);
	out[plaintext.length] = 0x80;
	return out;
}

export function unpad(padded: Uint8Array): Uint8Array {
	let end = padded.length - 1;
	while (end >= 0 && padded[end] === 0) end--;
	if (end < 0 || padded[end] !== 0x80) {
		throw new CryptoError('format_unsupported', 'padding marker missing');
	}
	return padded.subarray(0, end);
}
