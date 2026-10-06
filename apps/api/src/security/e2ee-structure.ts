// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Structural validation of E2EE payloads (15).
 *
 * The API never holds content keys and never decrypts. What it *can* check
 * cheaply is that signed objects are well-formed and signed by the claimed
 * member's public key. Clients still verify everything themselves against
 * the roster they trust — these checks only stop garbage and forgery attempts
 * by other parties early.
 *
 * Signature format: ECDSA P-256 / SHA-256, raw `r ‖ s` (64 bytes, what
 * WebCrypto produces), base64url. Every signature covers a context string.
 */
import { createPublicKey, verify } from 'node:crypto';
import {
	canonicalJson,
	fromBase64Url,
	parseSealedHeader,
	RosterStatementBody,
	type P256PublicJwk,
} from '@skillpouch/contracts';
import { AppError } from '../http/app-error';
import { blake3Hash } from './crypto-util';

export const CONTEXT = {
	roster: 'skillpouch/v1/roster',
	revision: 'skillpouch/v1/revision-sig',
	keyEnvelope: 'skillpouch/v1/key-envelope',
	checkpoint: 'skillpouch/v1/checkpoint',
} as const;

const encoder = new TextEncoder();

export function concatBytes(...parts: (Uint8Array | string)[]): Buffer {
	return Buffer.concat(
		parts.map((part) => (typeof part === 'string' ? encoder.encode(part) : part)),
	);
}

/** Verifies a raw P-256 signature over `context ‖ message`. */
export function verifyMemberSignature(
	publicJwk: Record<string, string>,
	signatureB64: string,
	context: string,
	message: Uint8Array,
): boolean {
	try {
		const { x, y } = publicJwk;
		if (!x || !y) return false;
		const key = createPublicKey({ key: { kty: 'EC', crv: 'P-256', x, y }, format: 'jwk' });
		const signature = fromBase64Url(signatureB64);
		if (signature.length !== 64) return false;
		return verify(
			'sha256',
			concatBytes(context, message),
			{ key, dsaEncoding: 'ieee-p1363' },
			signature,
		);
	} catch {
		return false;
	}
}

/** Message signed for a revision. */
export function revisionSignedMessage(
	pouchId: string,
	revisionId: string,
	envelope: Uint8Array,
): Buffer {
	return concatBytes(pouchId, revisionId, blake3Hash(envelope));
}

export interface ParsedStatement {
	bytes: Buffer;
	hash: Buffer;
	body: RosterStatementBody;
}

/** Parses a roster statement: size, UTF-8 JSON, canonical form, schema. */
export function parseRosterStatement(statementB64: string): ParsedStatement {
	const bytes = Buffer.from(fromBase64Url(statementB64));
	let json: unknown;
	try {
		json = JSON.parse(bytes.toString('utf8'));
	} catch {
		throw new AppError('roster_invalid', { reason: 'not JSON' });
	}
	if (canonicalJson(json) !== bytes.toString('utf8')) {
		throw new AppError('roster_invalid', { reason: 'not canonical JSON' });
	}
	const parsed = RosterStatementBody.safeParse(json);
	if (!parsed.success) {
		throw new AppError('roster_invalid', {
			reason: 'schema',
			issues: parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`),
		});
	}
	return { bytes, hash: blake3Hash(bytes), body: parsed.data };
}

/** Checks the 1-byte format + key generation header of a sealed object. */
export function checkSealed(bytes: Uint8Array, expectedKeyGen?: number): void {
	const header = parseSealedHeader(bytes);
	if (!header) throw new AppError('envelope_invalid', { reason: 'bad header' });
	if (expectedKeyGen !== undefined && header.keyGen !== expectedKeyGen) {
		throw new AppError('envelope_invalid', { reason: 'key generation mismatch' });
	}
}

export function samePublicKey(
	a: Pick<P256PublicJwk, 'x' | 'y'>,
	b: Record<string, string>,
): boolean {
	return a.x === b.x && a.y === b.y;
}
