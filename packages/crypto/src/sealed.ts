// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Sealed objects — the one ciphertext layout used for blobs, revision
 * envelopes, bindings and encrypted names:
 *
 *   sealed = 0x01 ‖ u32_be(key_gen) ‖ nonce(24) ‖ XChaCha20-Poly1305(key, nonce, pad(plaintext), aad)
 *
 * The header is authenticated too: the AAD passed to the cipher is
 * `header ‖ aad`, so a server cannot relabel a ciphertext with another key
 * generation.
 */
import { xchacha20poly1305 } from '@noble/ciphers/chacha.js';
import { SEALED_FORMAT_V1, SEALED_HEADER_BYTES, SEALED_MIN_BYTES } from '@skillpouch/contracts';
import { concat, randomBytes, readU32be, u32be } from './bytes';
import { CryptoError } from './errors';
import { pad, unpad } from './padding';

export interface SealOptions {
	/** Fixed nonce — only for deterministic test vectors. */
	nonce?: Uint8Array;
	/** Skip Padmé padding (used for tiny fixed-size payloads such as key material). */
	unpadded?: boolean;
}

export function seal(
	key: Uint8Array,
	keyGen: number,
	plaintext: Uint8Array,
	aad: Uint8Array,
	options: SealOptions = {},
): Uint8Array {
	const nonce = options.nonce ?? randomBytes(24);
	const header = concat(new Uint8Array([SEALED_FORMAT_V1]), u32be(keyGen), nonce);
	const body = options.unpadded ? plaintext : pad(plaintext);
	const ciphertext = xchacha20poly1305(key, nonce, concat(header, aad)).encrypt(body);
	return concat(header, ciphertext);
}

/** Reads the key generation without decrypting (to pick the right key). */
export function sealedKeyGen(sealed: Uint8Array): number {
	if (sealed.length < SEALED_MIN_BYTES || sealed[0] !== SEALED_FORMAT_V1) {
		throw new CryptoError('format_unsupported', 'not a v1 sealed object');
	}
	return readU32be(sealed, 1);
}

export function open(
	key: Uint8Array,
	sealed: Uint8Array,
	aad: Uint8Array,
	options: Pick<SealOptions, 'unpadded'> = {},
): Uint8Array {
	sealedKeyGen(sealed);
	const header = sealed.subarray(0, SEALED_HEADER_BYTES);
	const nonce = sealed.subarray(5, SEALED_HEADER_BYTES);
	let body: Uint8Array;
	try {
		body = xchacha20poly1305(key, nonce, concat(header, aad)).decrypt(
			sealed.subarray(SEALED_HEADER_BYTES),
		);
	} catch {
		throw new CryptoError('aead_failure', 'ciphertext failed authentication');
	}
	return options.unpadded ? body : unpad(body);
}
