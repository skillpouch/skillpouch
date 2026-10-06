// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Unlock pepper sealing.
 *
 * Every account has a random 32-byte pepper that the browser mixes into the
 * Argon2id output of the master password. The database only ever holds it
 * sealed with `PEPPER_KEY` (XChaCha20-Poly1305, AAD = account id), and that
 * key lives outside the database and its backups — so a stolen DB or backup
 * cannot even begin an offline guessing attack.
 *
 * Sealed format: `nonce(24) ‖ ciphertext(32) ‖ tag(16)`.
 */
import { randomBytes } from 'node:crypto';
import { xchacha20poly1305 } from '@noble/ciphers/chacha.js';
import { fromBase64Url } from '@skillpouch/contracts';
import { AppError } from '../http/app-error';

export interface SealedPepper {
	ciphertext: Buffer;
	keyId: string;
}

export class PepperBox {
	private readonly key: Uint8Array;

	constructor(
		keyBase64Url: string,
		readonly keyId: string,
	) {
		this.key = fromBase64Url(keyBase64Url);
		if (this.key.length !== 32)
			throw new AppError('internal_error', { reason: 'PEPPER_KEY must be 32 bytes' });
	}

	/** A fresh random pepper, sealed for `storageAccountId`. */
	create(storageAccountId: string): { pepper: Buffer; sealed: SealedPepper } {
		const pepper = randomBytes(32);
		return { pepper, sealed: this.seal(storageAccountId, pepper) };
	}

	seal(storageAccountId: string, pepper: Uint8Array): SealedPepper {
		const nonce = randomBytes(24);
		const cipher = xchacha20poly1305(this.key, nonce, aad(storageAccountId));
		return {
			ciphertext: Buffer.concat([nonce, cipher.encrypt(pepper)]),
			keyId: this.keyId,
		};
	}

	open(storageAccountId: string, sealed: SealedPepper): Buffer {
		if (sealed.keyId !== this.keyId) {
			// Rotation re-seals every row before the old key is dropped.
			throw new AppError('internal_error', { reason: 'unknown pepper key id' });
		}
		const nonce = sealed.ciphertext.subarray(0, 24);
		const body = sealed.ciphertext.subarray(24);
		try {
			return Buffer.from(
				xchacha20poly1305(this.key, nonce, aad(storageAccountId)).decrypt(body),
			);
		} catch {
			throw new AppError('internal_error', { reason: 'pepper does not open' });
		}
	}
}

function aad(storageAccountId: string): Uint8Array {
	return new TextEncoder().encode(`skillpouch/v1/pepper|${storageAccountId}`);
}
