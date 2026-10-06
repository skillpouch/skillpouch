// SPDX-License-Identifier: AGPL-3.0-only
/**
 * DPoP proofs (RFC 9449) signed with this browser's non-extractable key.
 *
 * Every API request carries one. The web session cookie alone is useless to
 * a thief: the server only accepts it together with a proof from the key the
 * session was bound to, and that key cannot leave the browser.
 */
import { b64, utf8, type PublicJwk } from '@skillpouch/crypto';

export interface DpopKey {
	signKey: CryptoKey;
	signPub: PublicJwk;
}

function encodeJson(value: unknown): string {
	return b64(utf8(JSON.stringify(value)));
}

/** A compact ES256 JWS: WebCrypto's raw r‖s signature is exactly the JWS format. */
export async function createDpopProof(
	key: DpopKey,
	method: string,
	url: string,
	nonce: string | null,
): Promise<string> {
	const header = encodeJson({ typ: 'dpop+jwt', alg: 'ES256', jwk: key.signPub });
	const payload = encodeJson({
		htm: method,
		htu: url,
		jti: crypto.randomUUID(),
		iat: Math.floor(Date.now() / 1000),
		...(nonce ? { nonce } : {}),
	});
	const signingInput = `${header}.${payload}`;
	const signature = await crypto.subtle.sign(
		{ name: 'ECDSA', hash: 'SHA-256' },
		key.signKey,
		utf8(signingInput) as Uint8Array<ArrayBuffer>,
	);
	return `${signingInput}.${b64(new Uint8Array(signature))}`;
}
