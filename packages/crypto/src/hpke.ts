// SPDX-License-Identifier: AGPL-3.0-only
/**
 * HPKE (RFC 9180) base mode with DHKEM(P-256, HKDF-SHA256), HKDF-SHA256 and
 * ChaCha20-Poly1305 — used to wrap key material to one member's `enc_pub`
 * (key envelopes, the CLI welcome).
 */
import { Chacha20Poly1305 } from '@hpke/chacha20poly1305';
import { CipherSuite, DhkemP256HkdfSha256, HkdfSha256 } from '@hpke/core';
import { exact } from './bytes';
import { CryptoError } from './errors';
import type { PublicJwk } from './keys';

let cachedSuite: CipherSuite | undefined;
function suite(): CipherSuite {
	cachedSuite ??= new CipherSuite({
		kem: new DhkemP256HkdfSha256(),
		kdf: new HkdfSha256(),
		aead: new Chacha20Poly1305(),
	});
	return cachedSuite;
}

export interface HpkeSealed {
	/** Encapsulated ephemeral public key (65 bytes). */
	enc: Uint8Array;
	ciphertext: Uint8Array;
}

export async function hpkeSeal(
	recipient: PublicJwk,
	info: Uint8Array,
	aad: Uint8Array,
	plaintext: Uint8Array,
): Promise<HpkeSealed> {
	const recipientPublicKey = await suite().kem.importKey('jwk', { ...recipient }, true);
	const sealed = await suite().seal(
		{ recipientPublicKey, info: exact(info) },
		exact(plaintext),
		exact(aad),
	);
	return { enc: new Uint8Array(sealed.enc), ciphertext: new Uint8Array(sealed.ct) };
}

/** The recipient's ECDH private key together with its public JWK (HPKE binds both). */
export interface HpkeRecipientKey {
	encKey: CryptoKey;
	encPub: PublicJwk;
}

export async function hpkeOpen(
	recipient: HpkeRecipientKey,
	sealed: HpkeSealed,
	info: Uint8Array,
	aad: Uint8Array,
): Promise<Uint8Array> {
	try {
		const publicKey = await suite().kem.importKey('jwk', { ...recipient.encPub }, true);
		const plaintext = await suite().open(
			{
				recipientKey: { privateKey: recipient.encKey, publicKey },
				enc: exact(sealed.enc),
				info: exact(info),
			},
			exact(sealed.ciphertext),
			exact(aad),
		);
		return new Uint8Array(plaintext);
	} catch {
		throw new CryptoError('aead_failure', 'sealed key material failed to open');
	}
}
