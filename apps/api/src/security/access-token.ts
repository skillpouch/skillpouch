// SPDX-License-Identifier: AGPL-3.0-only
/**
 * DPoP-bound access tokens for CLI devices (plan 08 §3.2): EdDSA JWTs, 5 min
 * lifetime, bound to the device key via `cnf.jkt`, carrying the device's
 * `token_version` (`ver`) so revocation is effective on the next request.
 */
import { Limits } from '@skillpouch/contracts';
import {
	SignJWT,
	exportJWK,
	generateKeyPair,
	importJWK,
	jwtVerify,
	type CryptoKey,
	type JWK,
} from 'jose';
import { AppError } from '../http/app-error';

export interface AccessTokenClaims {
	/** User id. */
	sub: string;
	/** Storage account id. */
	sa: string;
	/** Device id. */
	did: string;
	/** Device key thumbprint. */
	jkt: string;
	/** Device token version. */
	ver: number;
	scope: string;
}

const ISSUER = 'https://skillpouch.net';
const AUDIENCE = 'skillpouch-api';

export class AccessTokens {
	private constructor(
		private readonly privateKey: CryptoKey,
		private readonly publicKey: CryptoKey,
		private readonly kid: string,
		private readonly now: () => Date,
	) {}

	/** Loads the signing key from a private JWK, or generates an ephemeral one (dev/test). */
	static async create(privateJwkJson: string | undefined, now: () => Date): Promise<AccessTokens> {
		if (privateJwkJson) {
			const jwk = JSON.parse(privateJwkJson) as JWK;
			const privateKey = (await importJWK(jwk, 'EdDSA')) as CryptoKey;
			const { d: _d, ...publicJwk } = jwk;
			const publicKey = (await importJWK(publicJwk, 'EdDSA')) as CryptoKey;
			return new AccessTokens(privateKey, publicKey, jwk.kid ?? 'main', now);
		}
		const { privateKey, publicKey } = await generateKeyPair('EdDSA', { crv: 'Ed25519' });
		return new AccessTokens(privateKey, publicKey, 'ephemeral', now);
	}

	/** Generates a new private JWK for `JWT_SIGNING_KEY` (used by `pnpm ops keygen`). */
	static async generatePrivateJwk(kid: string): Promise<JWK> {
		const { privateKey } = await generateKeyPair('EdDSA', { crv: 'Ed25519', extractable: true });
		return { ...(await exportJWK(privateKey)), kid, alg: 'EdDSA', use: 'sig' };
	}

	async issue(claims: AccessTokenClaims): Promise<{ token: string; expiresIn: number }> {
		const issuedAt = Math.floor(this.now().getTime() / 1000);
		const token = await new SignJWT({
			sa: claims.sa,
			did: claims.did,
			ver: claims.ver,
			scope: claims.scope,
			cnf: { jkt: claims.jkt },
		})
			.setProtectedHeader({ alg: 'EdDSA', kid: this.kid, typ: 'at+jwt' })
			.setSubject(claims.sub)
			.setIssuer(ISSUER)
			.setAudience(AUDIENCE)
			.setIssuedAt(issuedAt)
			.setExpirationTime(issuedAt + Limits.accessTokenTtlSeconds)
			.sign(this.privateKey);
		return { token, expiresIn: Limits.accessTokenTtlSeconds };
	}

	async verify(token: string): Promise<AccessTokenClaims> {
		try {
			const { payload } = await jwtVerify(token, this.publicKey, {
				issuer: ISSUER,
				audience: AUDIENCE,
				typ: 'at+jwt',
				algorithms: ['EdDSA'],
				currentDate: this.now(),
			});
			const cnf = payload.cnf as { jkt?: unknown } | undefined;
			if (
				typeof payload.sub !== 'string' ||
				typeof payload.sa !== 'string' ||
				typeof payload.did !== 'string' ||
				typeof payload.ver !== 'number' ||
				typeof cnf?.jkt !== 'string'
			) {
				throw new Error('missing claims');
			}
			return {
				sub: payload.sub,
				sa: payload.sa,
				did: payload.did,
				ver: payload.ver,
				jkt: cnf.jkt,
				scope: typeof payload.scope === 'string' ? payload.scope : '',
			};
		} catch {
			throw new AppError('token_invalid');
		}
	}
}
