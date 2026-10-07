// SPDX-License-Identifier: AGPL-3.0-only
/**
 * What a SkillPouch CLI does on the wire, minus the encryption itself:
 * P-256 keys, DPoP proofs, detached request signatures, signed revision
 * envelopes and sealed-looking blobs. Content is random bytes — the server
 * never sees plaintext anyway, so its cost is the same.
 */
import {
	createHash,
	createSign,
	generateKeyPairSync,
	createPrivateKey,
	randomBytes,
	randomUUID,
} from 'node:crypto';
import { blake3 } from '@noble/hashes/blake3.js';

export const b64 = (bytes) => Buffer.from(bytes).toString('base64url');

export function canonicalJson(value) {
	if (
		value === null ||
		typeof value === 'boolean' ||
		typeof value === 'string' ||
		typeof value === 'number'
	)
		return JSON.stringify(value);
	if (Array.isArray(value))
		return `[${value.map((item) => canonicalJson(item ?? null)).join(',')}]`;
	const entries = Object.entries(value)
		.filter(([, v]) => v !== undefined)
		.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
	return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
}

/** UUIDv7: time-ordered, like the real clients generate. */
export function uuidv7() {
	const bytes = randomBytes(16);
	const ms = BigInt(Date.now());
	for (let index = 0; index < 6; index++)
		bytes[index] = Number((ms >> BigInt(40 - index * 8)) & 0xffn);
	bytes[6] = (bytes[6] & 0x0f) | 0x70;
	bytes[8] = (bytes[8] & 0x3f) | 0x80;
	const hex = bytes.toString('hex');
	return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export class Key {
	constructor(privateJwk) {
		this.privateJwk = privateJwk;
		this.key = createPrivateKey({ key: privateJwk, format: 'jwk' });
		this.jwk = { kty: 'EC', crv: 'P-256', x: privateJwk.x, y: privateJwk.y };
		this.jkt = b64(
			createHash('sha256')
				.update(`{"crv":"P-256","kty":"EC","x":"${this.jwk.x}","y":"${this.jwk.y}"}`)
				.digest(),
		);
	}

	static generate() {
		const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
		return new Key(privateKey.export({ format: 'jwk' }));
	}

	/** Raw r‖s ECDSA-SHA256 (what WebCrypto and the server use). */
	sign(data) {
		return createSign('sha256').update(data).sign({ key: this.key, dsaEncoding: 'ieee-p1363' });
	}

	dpop(method, url, nonce, accessToken) {
		const header = b64(JSON.stringify({ typ: 'dpop+jwt', alg: 'ES256', jwk: this.jwk }));
		const payload = {
			htm: method,
			htu: url,
			jti: randomUUID(),
			iat: Math.floor(Date.now() / 1000),
		};
		if (nonce) payload.nonce = nonce;
		if (accessToken) payload.ath = b64(createHash('sha256').update(accessToken).digest());
		const input = `${header}.${b64(JSON.stringify(payload))}`;
		return `${input}.${b64(this.sign(input))}`;
	}

	/** Detached JWS over base64url(BLAKE3(canonical body)): the `Skillpouch-Signature` header. */
	requestSignature(body) {
		const header = b64(JSON.stringify({ alg: 'ES256' }));
		const payload = b64(blake3(Buffer.from(canonicalJson(body))));
		return `${header}..${b64(this.sign(`${header}.${payload}`))}`;
	}
}

/** 0x01 ‖ u32 key generation ‖ 24-byte nonce ‖ ciphertext ‖ 16-byte tag. */
export function sealed(keyGen, plaintextBytes) {
	const header = Buffer.alloc(5);
	header[0] = 0x01;
	header.writeUInt32BE(keyGen, 1);
	return Buffer.concat([header, randomBytes(24 + plaintextBytes + 16)]);
}

export function blake3Hash(bytes) {
	return Buffer.from(blake3(bytes));
}

/** One signed `create` or `update` operation, as the CLI commits it. */
export function buildOp(
	key,
	memberId,
	pouchId,
	{ type, artifactId, baseRevisionId, blobIds, envelopeBytes = 300 },
) {
	const revisionId = uuidv7();
	const envelope = sealed(1, envelopeBytes);
	const signature = key.sign(
		Buffer.concat([
			Buffer.from('skillpouch/v1/revision-sig'),
			Buffer.from(pouchId),
			Buffer.from(revisionId),
			blake3Hash(envelope),
		]),
	);
	return {
		type,
		artifact_id: artifactId,
		revision_id: revisionId,
		base_revision_id: baseRevisionId,
		merge_parent_id: null,
		name_index: type === 'create' ? b64(randomBytes(32)) : null,
		conflict_id: null,
		key_gen: 1,
		envelope: b64(envelope),
		signature: b64(signature),
		signer_member_id: memberId,
		blob_ids: blobIds,
	};
}
