// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Structural view of client-encrypted objects:
 *
 *   sealed = format(1 byte = 0x01) ‖ u32_be(key_gen) ‖ nonce(24) ‖ ciphertext ‖ tag(16)
 *
 * The API never decrypts. It only checks this header so obviously malformed
 * uploads are rejected early and the declared key generation can be compared
 * with the pouch's current generation.
 */
export const SEALED_FORMAT_V1 = 0x01;
export const SEALED_HEADER_BYTES = 1 + 4 + 24;
export const SEALED_MIN_BYTES = SEALED_HEADER_BYTES + 16;

export interface SealedHeader {
	format: number;
	keyGen: number;
}

/** Returns the header or `null` when the bytes cannot be a v1 sealed object. */
export function parseSealedHeader(bytes: Uint8Array): SealedHeader | null {
	if (bytes.length < SEALED_MIN_BYTES || bytes[0] !== SEALED_FORMAT_V1) return null;
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	const keyGen = view.getUint32(1, false);
	if (keyGen < 1) return null;
	return { format: SEALED_FORMAT_V1, keyGen };
}
