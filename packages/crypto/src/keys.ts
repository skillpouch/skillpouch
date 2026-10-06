// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Member key pairs: one P-256 ECDSA key (signatures) and one P-256 ECDH key
 * (HPKE recipient for key envelopes).
 *
 * Private keys always live in WebCrypto `CryptoKey` objects, so a browser
 * member's keys can be non-extractable (stored as-is in IndexedDB) and
 * secret-derived members (master password, Recovery Key, passkey) use the
 * exact same signing and decryption code path.
 *
 * Signatures are raw `r ‖ s` (64 bytes, WebCrypto's format) over
 * `context ‖ message`; the context string gives every signature a purpose so
 * one can never be replayed as another.
 */
import { p256 } from '@noble/curves/nist.js';
import { hkdf } from '@noble/hashes/hkdf.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { b64, bytesEqual, concat, exact, unb64, utf8, wipe } from './bytes';
import { CryptoError } from './errors';

export interface PublicJwk {
	kty: 'EC';
	crv: 'P-256';
	x: string;
	y: string;
}

export interface MemberKeyPair {
	signPub: PublicJwk;
	encPub: PublicJwk;
	/** ECDSA P-256 private key (sign). */
	signKey: CryptoKey;
	/** ECDH P-256 private key (HPKE decapsulation). */
	encKey: CryptoKey;
}

const subtle = () => globalThis.crypto.subtle;
const ECDSA = { name: 'ECDSA', namedCurve: 'P-256' } as const;
const ECDH = { name: 'ECDH', namedCurve: 'P-256' } as const;

export function publicJwk(jwk: JsonWebKey): PublicJwk {
	if (jwk.kty !== 'EC' || jwk.crv !== 'P-256' || !jwk.x || !jwk.y) {
		throw new CryptoError('format_unsupported', 'not a P-256 public key');
	}
	return { kty: 'EC', crv: 'P-256', x: jwk.x, y: jwk.y };
}

export function sameKey(a: PublicJwk, b: PublicJwk): boolean {
	return a.x === b.x && a.y === b.y;
}

/** RFC 7638 JWK thumbprint (SHA-256, base64url) — the DPoP `jkt`. */
export function jwkThumbprint(jwk: PublicJwk): string {
	return b64(sha256(utf8(`{"crv":"P-256","kty":"EC","x":"${jwk.x}","y":"${jwk.y}"}`)));
}

/** Fresh random key pair. Browsers keep it non-extractable; tests may export it. */
export async function generateMemberKeyPair(extractable = false): Promise<MemberKeyPair> {
	const sign = (await subtle().generateKey(ECDSA, extractable, [
		'sign',
		'verify',
	])) as CryptoKeyPair;
	const enc = (await subtle().generateKey(ECDH, extractable, ['deriveBits'])) as CryptoKeyPair;
	return {
		signPub: publicJwk(await subtle().exportKey('jwk', sign.publicKey)),
		encPub: publicJwk(await subtle().exportKey('jwk', enc.publicKey)),
		signKey: sign.privateKey,
		encKey: enc.privateKey,
	};
}

/**
 * Turns 32 seed bytes into a valid P-256 scalar by hashing with a counter
 * until the candidate is in [1, n) (probability of a retry ≈ 2⁻³²).
 */
export function deriveScalar(seed: Uint8Array, label: string): Uint8Array {
	for (let counter = 0; counter < 256; counter++) {
		const candidate = hkdf(
			sha256,
			seed,
			new Uint8Array(0),
			concat(`skillpouch/v1/scalar/${label}`, new Uint8Array([counter])),
			32,
		);
		if (p256.utils.isValidSecretKey(candidate)) return candidate;
		wipe(candidate);
	}
	throw new CryptoError('format_unsupported', 'could not derive a scalar');
}

async function importScalar(
	scalar: Uint8Array,
	usage: 'sign' | 'deriveBits',
): Promise<{
	privateKey: CryptoKey;
	publicJwk: PublicJwk;
}> {
	const point = p256.getPublicKey(scalar, false);
	const jwk: PublicJwk = {
		kty: 'EC',
		crv: 'P-256',
		x: b64(point.subarray(1, 33)),
		y: b64(point.subarray(33, 65)),
	};
	const privateKey = await subtle().importKey(
		'jwk',
		{ ...jwk, d: b64(scalar), ext: false },
		usage === 'sign' ? ECDSA : ECDH,
		false,
		[usage],
	);
	return { privateKey, publicJwk: jwk };
}

/** Deterministic key pair of a secret-derived member (`seed` from `memberSeed`). */
export async function deriveMemberKeyPair(seed: Uint8Array): Promise<MemberKeyPair> {
	const signScalar = deriveScalar(seed, 'sign');
	const encScalar = deriveScalar(seed, 'enc');
	try {
		const sign = await importScalar(signScalar, 'sign');
		const enc = await importScalar(encScalar, 'deriveBits');
		return {
			signPub: sign.publicJwk,
			encPub: enc.publicJwk,
			signKey: sign.privateKey,
			encKey: enc.privateKey,
		};
	} finally {
		wipe(signScalar, encScalar);
	}
}

/** Raw P-256 signature over `context ‖ message`, base64url. */
export async function sign(key: CryptoKey, context: string, message: Uint8Array): Promise<string> {
	const signature = await subtle().sign(
		{ name: 'ECDSA', hash: 'SHA-256' },
		key,
		exact(concat(context, message)),
	);
	return b64(new Uint8Array(signature));
}

export async function verify(
	jwk: PublicJwk,
	signatureB64: string,
	context: string,
	message: Uint8Array,
): Promise<boolean> {
	const signature = unb64(signatureB64);
	if (signature.length !== 64) return false;
	try {
		const key = await subtle().importKey('jwk', jwk, ECDSA, false, ['verify']);
		return await subtle().verify(
			{ name: 'ECDSA', hash: 'SHA-256' },
			key,
			exact(signature),
			exact(concat(context, message)),
		);
	} catch {
		return false;
	}
}

/** Like `verify`, but throws a `signature_invalid` CryptoError. */
export async function requireSignature(
	jwk: PublicJwk,
	signatureB64: string,
	context: string,
	message: Uint8Array,
	what: string,
): Promise<void> {
	if (!(await verify(jwk, signatureB64, context, message))) {
		throw new CryptoError('signature_invalid', `${what}: signature does not verify`);
	}
}

/** Compares two public keys given as JWKs or raw points. */
export function publicKeysEqual(a: PublicJwk, b: PublicJwk): boolean {
	return bytesEqual(unb64(a.x), unb64(b.x)) && bytesEqual(unb64(a.y), unb64(b.y));
}
