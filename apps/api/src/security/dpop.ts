// SPDX-License-Identifier: AGPL-3.0-only
/**
 * DPoP proof verification, RFC 9449 (plan 08 §3.2, §5.2).
 *
 * A proof is a JWT signed by the caller's P-256 key with the public key in the
 * header. We check: algorithm/type, signature, `htm`/`htu` match this request,
 * `iat` within ±60 s, `ath` binds the access token (when one is presented), the
 * server nonce, and finally that `jti` was never seen before (replay cache).
 */
import { createHash } from 'node:crypto';
import { Limits } from '@skillpouch/contracts';
import {
	calculateJwkThumbprint,
	decodeProtectedHeader,
	importJWK,
	jwtVerify,
	type JWK,
	type JWTPayload,
} from 'jose';
import { AppError } from '../http/app-error';
import type { NonceService } from './nonce';

export interface DpopExpectation {
	method: string;
	/** Absolute request URL without query/fragment. */
	url: string;
	/** The access token sent in `Authorization: DPoP …`, if any. */
	accessToken?: string;
}

export interface DpopResult {
	jkt: string;
	jwk: Record<string, string>;
}

export interface DpopVerifierDeps {
	nonces: NonceService;
	/** Records a `jti`; returns false if it was already used. */
	recordJti(jti: string, expiresAt: Date): Promise<boolean>;
	now(): Date;
}

function invalid(reason: string): AppError {
	return new AppError('dpop_invalid', { reason });
}

export function accessTokenHash(token: string): string {
	return createHash('sha256').update(token).digest('base64url');
}

export async function verifyDpopProof(
	proof: string | undefined,
	expected: DpopExpectation,
	deps: DpopVerifierDeps,
): Promise<DpopResult> {
	if (!proof || proof.length > 4096 || proof.includes(',')) throw invalid('missing or malformed proof');

	let header: ReturnType<typeof decodeProtectedHeader>;
	try {
		header = decodeProtectedHeader(proof);
	} catch {
		throw invalid('malformed header');
	}
	const jwk = header.jwk as JWK | undefined;
	if (header.typ !== 'dpop+jwt' || header.alg !== 'ES256' || !jwk) throw invalid('bad header');
	if (jwk.kty !== 'EC' || jwk.crv !== 'P-256' || 'd' in jwk) throw invalid('bad key');

	let payload: JWTPayload;
	try {
		const key = await importJWK(jwk, 'ES256');
		({ payload } = await jwtVerify(proof, key, { typ: 'dpop+jwt', algorithms: ['ES256'] }));
	} catch {
		throw invalid('signature');
	}

	if (payload.htm !== expected.method) throw invalid('htm');
	if (payload.htu !== expected.url) throw invalid('htu');
	const nowSeconds = Math.floor(deps.now().getTime() / 1000);
	if (typeof payload.iat !== 'number' || Math.abs(nowSeconds - payload.iat) > Limits.dpopIatWindowSeconds) {
		throw invalid('iat');
	}
	if (typeof payload.jti !== 'string' || payload.jti.length < 8 || payload.jti.length > 128) {
		throw invalid('jti');
	}
	if (expected.accessToken !== undefined) {
		if (payload.ath !== accessTokenHash(expected.accessToken)) throw invalid('ath');
	}
	if (!deps.nonces.isValid(payload.nonce)) {
		throw new AppError('dpop_nonce_required', undefined, {
			headers: { 'DPoP-Nonce': deps.nonces.current() },
		});
	}
	const expiresAt = new Date((payload.iat + 2 * Limits.dpopIatWindowSeconds) * 1000);
	if (!(await deps.recordJti(payload.jti, expiresAt))) throw new AppError('dpop_replay');

	const publicJwk = { kty: 'EC', crv: 'P-256', x: String(jwk.x), y: String(jwk.y) };
	return { jkt: await calculateJwkThumbprint(publicJwk, 'sha256'), jwk: publicJwk };
}

/** RFC 7638 thumbprint of a P-256 public JWK. */
export function jwkThumbprint(jwk: { kty: string; crv: string; x: string; y: string }): Promise<string> {
	return calculateJwkThumbprint({ kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y }, 'sha256');
}
