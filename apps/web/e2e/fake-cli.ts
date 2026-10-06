// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A minimal stand-in for the `skillpouch` CLI, enough to log in the way the
 * real one does: fresh device keys, PKCE, DPoP-signed requests, then the
 * welcome sealed to this device by the browser that approved it.
 *
 * It talks to the same origin as the browser (the dev server proxies `/v1`),
 * so DPoP `htu` values match what the API expects.
 */
import { createHash, randomBytes } from 'node:crypto';
import {
	b64,
	confirmCode,
	generateMemberKeyPair,
	jwkThumbprint,
	openWelcome,
	sameKey,
	utf8,
	type MemberKeyPair,
	type PublicJwk,
	type Welcome,
} from '@skillpouch/crypto';

const base64url = (bytes: Uint8Array) => Buffer.from(bytes).toString('base64url');

export interface CliLogin {
	deviceId: string;
	memberId: string;
	accessToken: string;
	welcome: Welcome;
}

export class FakeCli {
	private nonce: string | null = null;
	private accessToken: string | null = null;

	private constructor(
		readonly origin: string,
		readonly keys: MemberKeyPair,
		readonly name: string,
	) {}

	static async create(origin: string, name = 'e2e-laptop'): Promise<FakeCli> {
		return new FakeCli(origin, await generateMemberKeyPair(), name);
	}

	private async proof(method: string, path: string): Promise<string> {
		const encode = (value: unknown) => b64(utf8(JSON.stringify(value)));
		const header = encode({ typ: 'dpop+jwt', alg: 'ES256', jwk: this.keys.signPub });
		const payload = encode({
			htm: method,
			htu: `${this.origin}${path.split('?')[0]}`,
			jti: crypto.randomUUID(),
			iat: Math.floor(Date.now() / 1000),
			...(this.nonce ? { nonce: this.nonce } : {}),
			...(this.accessToken
				? { ath: base64url(createHash('sha256').update(this.accessToken).digest()) }
				: {}),
		});
		const input = `${header}.${payload}`;
		const signature = await crypto.subtle.sign(
			{ name: 'ECDSA', hash: 'SHA-256' },
			this.keys.signKey,
			utf8(input) as Uint8Array<ArrayBuffer>,
		);
		return `${input}.${b64(new Uint8Array(signature))}`;
	}

	/** One API call; retries once when the server hands out a fresh DPoP nonce. */
	async call<T = unknown>(
		method: string,
		path: string,
		body?: unknown,
	): Promise<{ status: number; data: T; error?: { code: string } }> {
		for (let attempt = 0; ; attempt++) {
			const headers: Record<string, string> = {
				dpop: await this.proof(method, path),
				'skillpouch-client': 'cli/e2e',
			};
			if (this.accessToken) headers.authorization = `DPoP ${this.accessToken}`;
			if (body !== undefined) headers['content-type'] = 'application/json';
			const response = await fetch(`${this.origin}${path}`, {
				method,
				headers,
				...(body !== undefined ? { body: JSON.stringify(body) } : {}),
			});
			const nonce = response.headers.get('dpop-nonce');
			if (nonce) this.nonce = nonce;
			const json = (await response.json()) as {
				data: T;
				error?: { code: string };
			};
			if (json.error?.code === 'dpop_nonce_required' && attempt === 0) continue;
			return {
				status: response.status,
				data: json.data,
				...(json.error ? { error: json.error } : {}),
			};
		}
	}

	/**
	 * Logs in like `skillpouch login <token>` (with a connect token) or
	 * `skillpouch login` (without: `onRequest` gets the authorize URL and the
	 * confirm code the CLI would print).
	 */
	async login(
		connectToken?: string,
		onRequest?: (request: { authorizeUrl: string; confirmCode: string }) => void,
	): Promise<CliLogin> {
		const verifier = base64url(randomBytes(32));
		const created = await this.call<{ request_id: string; authorize_url: string }>(
			'POST',
			'/v1/cli-auth/requests',
			{
				code_challenge: base64url(createHash('sha256').update(verifier).digest()),
				device_name: this.name,
				os: 'linux',
				arch: 'x86_64',
				cli_version: '0.1.0',
				sign_pub: this.keys.signPub,
				enc_pub: this.keys.encPub,
				key_storage: 'file',
				assistants: ['claude-code', 'opencode'],
				...(connectToken ? { connect_token: connectToken } : {}),
			},
		);
		if (created.status !== 200) throw new Error(`request failed: ${created.error?.code}`);
		const requestId = created.data.request_id;
		onRequest?.({
			authorizeUrl: created.data.authorize_url,
			confirmCode: await confirmCode(
				requestId,
				this.keys.signPub,
				this.keys.encPub,
				jwkThumbprint(this.keys.signPub),
			),
		});

		const deadline = Date.now() + 60_000;
		for (;;) {
			const token = await this.call<{
				status: 'pending' | 'approved';
				access_token: string;
				device_id: string;
				welcome: string;
			}>('POST', '/v1/cli-auth/token', {
				request_id: requestId,
				code_verifier: verifier,
				wait: 5,
			});
			if (token.status !== 200) throw new Error(`token failed: ${token.error?.code}`);
			if (token.data.status === 'approved') {
				this.accessToken = token.data.access_token;
				const memberId = await this.ownMemberId();
				const welcome = await openWelcome(this.keys, memberId, token.data.welcome);
				return {
					deviceId: token.data.device_id,
					memberId,
					accessToken: token.data.access_token,
					welcome,
				};
			}
			if (Date.now() > deadline) throw new Error('login was never approved');
		}
	}

	private async ownMemberId(): Promise<string> {
		const members = await this.call<{
			members: { id: string; kind: string; sign_pub: PublicJwk }[];
		}>('GET', '/v1/account/members');
		const own = members.data.members.find(
			(member) => member.kind === 'device' && sameKey(member.sign_pub, this.keys.signPub),
		);
		if (!own) throw new Error('this device is not in the roster');
		return own.id;
	}
}
