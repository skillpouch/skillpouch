// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A tiny software WebAuthn authenticator (ES256, "none" attestation) so tests
 * can exercise passkey registration and assertion end to end, exactly as a
 * browser would hand them to the API (@simplewebauthn/browser JSON shapes).
 */
import { createHash, generateKeyPairSync, randomBytes, sign, type KeyObject } from 'node:crypto';
import { isoCBOR } from '@simplewebauthn/server/helpers';

const b64 = (bytes: Uint8Array) => Buffer.from(bytes).toString('base64url');
const sha256 = (data: Uint8Array) => createHash('sha256').update(data).digest();

const FLAG_UP = 0x01;
const FLAG_UV = 0x04;
const FLAG_AT = 0x40;

export class SoftAuthenticator {
	readonly credentialId = randomBytes(32);
	private readonly privateKey: KeyObject;
	private readonly publicKey: KeyObject;
	private counter = 0;

	constructor(
		readonly origin: string,
		readonly rpId: string,
	) {
		const pair = generateKeyPairSync('ec', { namedCurve: 'P-256' });
		this.privateKey = pair.privateKey;
		this.publicKey = pair.publicKey;
	}

	private coseKey(): Uint8Array {
		const jwk = this.publicKey.export({ format: 'jwk' });
		return isoCBOR.encode(
			new Map<number, number | Uint8Array>([
				[1, 2],
				[3, -7],
				[-1, 1],
				[-2, Buffer.from(jwk.x!, 'base64url')],
				[-3, Buffer.from(jwk.y!, 'base64url')],
			]),
		);
	}

	private clientData(type: string, challenge: string): Buffer {
		return Buffer.from(
			JSON.stringify({ type, challenge, origin: this.origin, crossOrigin: false }),
		);
	}

	/** `navigator.credentials.create()` for the given registration options. */
	register(options: { challenge: string }) {
		const clientDataJSON = this.clientData('webauthn.create', options.challenge);
		const idLength = Buffer.alloc(2);
		idLength.writeUInt16BE(this.credentialId.length);
		const authData = Buffer.concat([
			sha256(Buffer.from(this.rpId)),
			Buffer.from([FLAG_UP | FLAG_UV | FLAG_AT]),
			Buffer.alloc(4),
			Buffer.alloc(16),
			idLength,
			this.credentialId,
			this.coseKey(),
		]);
		const attestationObject = isoCBOR.encode(
			new Map<string, unknown>([
				['fmt', 'none'],
				['attStmt', new Map()],
				['authData', authData],
			]) as never,
		);
		return {
			id: b64(this.credentialId),
			rawId: b64(this.credentialId),
			type: 'public-key',
			response: {
				clientDataJSON: b64(clientDataJSON),
				attestationObject: b64(attestationObject),
				transports: ['internal'],
			},
			clientExtensionResults: { prf: { enabled: true } },
		};
	}

	/**
	 * `navigator.credentials.get()` for the given assertion options, as the
	 * web client sends it: the PRF output stays local unless `leakPrf`.
	 */
	assert(options: { challenge: string }, { leakPrf = false } = {}) {
		this.counter += 1;
		const clientDataJSON = this.clientData('webauthn.get', options.challenge);
		const counter = Buffer.alloc(4);
		counter.writeUInt32BE(this.counter);
		const authData = Buffer.concat([
			sha256(Buffer.from(this.rpId)),
			Buffer.from([FLAG_UP | FLAG_UV]),
			counter,
		]);
		const signature = sign(
			'sha256',
			Buffer.concat([authData, sha256(clientDataJSON)]),
			this.privateKey,
		);
		return {
			id: b64(this.credentialId),
			rawId: b64(this.credentialId),
			type: 'public-key',
			response: {
				clientDataJSON: b64(clientDataJSON),
				authenticatorData: b64(authData),
				signature: b64(signature),
			},
			clientExtensionResults: leakPrf
				? { prf: { results: { first: b64(randomBytes(32)) } } }
				: {},
		};
	}
}
