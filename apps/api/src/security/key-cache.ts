// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Imported P-256 public keys, by their coordinates. Every request verifies a
 * DPoP proof (and CLI commits a request signature) with a key the client sent
 * before; importing it again each time costs more than the verification.
 * Bounded: the oldest keys are dropped first.
 */
import { importJWK, type CryptoKey } from 'jose';

const MAX_KEYS = 20_000;
const keys = new Map<string, Promise<CryptoKey>>();

export function importP256(jwk: { x?: unknown; y?: unknown }): Promise<CryptoKey> {
	const id = `${String(jwk.x)}.${String(jwk.y)}`;
	let key = keys.get(id);
	if (key) {
		keys.delete(id);
		keys.set(id, key);
		return key;
	}
	key = importJWK({ kty: 'EC', crv: 'P-256', x: String(jwk.x), y: String(jwk.y) }, 'ES256').then(
		(imported) => imported as CryptoKey,
	);
	// An invalid point must not stay cached as a rejected promise.
	key.catch(() => keys.delete(id));
	keys.set(id, key);
	if (keys.size > MAX_KEYS) keys.delete(keys.keys().next().value!);
	return key;
}
