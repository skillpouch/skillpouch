// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A P-256 key as a CLI device or a browser holds it: signs DPoP proofs and
 * E2EE statements (raw r‖s ECDSA, exactly like WebCrypto).
 */
import { createHash, randomUUID, webcrypto } from 'node:crypto';
import { SignJWT, calculateJwkThumbprint, exportJWK, generateKeyPair, type CryptoKey } from 'jose';

export interface PublicJwk {
	kty: 'EC';
	crv: 'P-256';
	x: string;
	y: string;
}

export class TestKey {
	private constructor(
		readonly privateKey: CryptoKey,
		readonly jwk: PublicJwk,
		readonly jkt: string,
	) {}

	static async generate(): Promise<TestKey> {
		const { privateKey, publicKey } = await generateKeyPair('ES256', { extractable: true });
		const exported = await exportJWK(publicKey);
		const jwk: PublicJwk = { kty: 'EC', crv: 'P-256', x: exported.x!, y: exported.y! };
		return new TestKey(privateKey, jwk, await calculateJwkThumbprint(jwk, 'sha256'));
	}

	/** Raw (r‖s) ECDSA-SHA256 signature over `context ‖ message`, base64url. */
	async sign(context: string, message: Uint8Array): Promise<string> {
		const data = Buffer.concat([Buffer.from(context), Buffer.from(message)]);
		const signature = await webcrypto.subtle.sign(
			{ name: 'ECDSA', hash: 'SHA-256' },
			this.privateKey as unknown as webcrypto.CryptoKey,
			data,
		);
		return Buffer.from(signature).toString('base64url');
	}

	/** A DPoP proof (RFC 9449) for one request. */
	dpop(method: string, url: string, options: { nonce?: string | undefined; accessToken?: string; iat?: number; jti?: string } = {}) {
		const payload: Record<string, unknown> = {
			htm: method,
			htu: url,
			jti: options.jti ?? randomUUID(),
		};
		if (options.nonce) payload.nonce = options.nonce;
		if (options.accessToken) {
			payload.ath = createHash('sha256').update(options.accessToken).digest('base64url');
		}
		return new SignJWT(payload)
			.setProtectedHeader({ alg: 'ES256', typ: 'dpop+jwt', jwk: this.jwk })
			.setIssuedAt(options.iat ?? Math.floor(Date.now() / 1000))
			.sign(this.privateKey);
	}
}
