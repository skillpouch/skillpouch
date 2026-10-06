// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Test clients that behave like the real web app and CLI on the wire:
 * session cookie / access token, DPoP proof per request, server nonce
 * handling, `Skillpouch-Client` header and Origin.
 */
import type { LightMyRequestResponse } from 'fastify';
import type { Harness } from './harness';
import { API_URL, WEB_ORIGIN } from './harness';
import { TestKey } from './keys';

export interface ApiResponse<T = any> {
	status: number;
	headers: Record<string, string | string[] | number | undefined>;
	body: T;
	raw: LightMyRequestResponse;
}

export interface RequestOptions {
	body?: unknown;
	rawBody?: Buffer;
	headers?: Record<string, string>;
	/** Skip the DPoP proof (negative tests). */
	noDpop?: boolean;
	/** Use this key for the proof instead of the client's own. */
	dpopKey?: TestKey;
}

/** Shared nonce cache; the API returns a fresh nonce on every response. */
const nonces = new WeakMap<Harness, string>();

function parse(response: LightMyRequestResponse): ApiResponse {
	const type = String(response.headers['content-type'] ?? '');
	const body = type.includes('application/json') ? response.json() : response.rawPayload;
	return { status: response.statusCode, headers: response.headers, body, raw: response };
}

export abstract class BaseClient {
	constructor(
		readonly harness: Harness,
		readonly key: TestKey,
	) {}

	protected abstract authHeaders(options: RequestOptions): Record<string, string>;
	protected abstract accessToken(): string | undefined;

	async request<T = any>(
		method: string,
		path: string,
		options: RequestOptions = {},
	): Promise<ApiResponse<T>> {
		for (let attempt = 0; attempt < 2; attempt++) {
			const headers: Record<string, string> = {
				...this.authHeaders(options),
				...options.headers,
			};
			if (!options.noDpop) {
				const proofKey = options.dpopKey ?? this.key;
				const accessToken = this.accessToken();
				headers.dpop = await proofKey.dpop(method, `${API_URL}${path.split('?')[0]}`, {
					nonce: nonces.get(this.harness),
					...(accessToken ? { accessToken } : {}),
				});
			}
			let payload: string | Buffer | undefined;
			if (options.rawBody) {
				payload = options.rawBody;
				headers['content-type'] ??= 'application/octet-stream';
			} else if (options.body !== undefined) {
				payload = JSON.stringify(options.body);
				headers['content-type'] = 'application/json';
			}
			const response = await this.harness.app.inject({
				method: method as 'GET',
				url: path,
				headers,
				...(payload === undefined ? {} : { payload }),
			});
			const nonce = response.headers['dpop-nonce'];
			if (typeof nonce === 'string') nonces.set(this.harness, nonce);
			const parsed = parse(response);
			if (
				parsed.body?.error?.code === 'dpop_nonce_required' &&
				attempt === 0 &&
				!options.noDpop
			)
				continue;
			return parsed as ApiResponse<T>;
		}
		throw new Error('unreachable');
	}

	get = <T = any>(path: string, options?: RequestOptions) =>
		this.request<T>('GET', path, options);
	post = <T = any>(path: string, body?: unknown, options: RequestOptions = {}) =>
		this.request<T>('POST', path, { ...options, body: body ?? {} });
	put = <T = any>(path: string, body?: unknown, options: RequestOptions = {}) =>
		this.request<T>('PUT', path, { ...options, body: body ?? {} });
	patch = <T = any>(path: string, body?: unknown, options: RequestOptions = {}) =>
		this.request<T>('PATCH', path, { ...options, body: body ?? {} });
	delete = <T = any>(path: string, options: RequestOptions = {}) =>
		this.request<T>('DELETE', path, options);
}

/** A signed-in browser tab. */
export class BrowserClient extends BaseClient {
	memberId: string | null = null;

	constructor(
		harness: Harness,
		key: TestKey,
		public cookie: string,
		readonly userId: string,
		readonly email: string,
	) {
		super(harness, key);
	}

	protected authHeaders(): Record<string, string> {
		return { cookie: this.cookie, origin: WEB_ORIGIN, 'skillpouch-client': 'web/test' };
	}

	protected accessToken(): undefined {
		return undefined;
	}

	async bind(): Promise<void> {
		const response = await this.post('/v1/session/bind');
		if (response.status !== 200)
			throw new Error(`bind failed: ${JSON.stringify(response.body)}`);
	}
}

/** A logged-in CLI device. */
export class CliClient extends BaseClient {
	accessTokenValue = '';
	refreshToken = '';
	deviceId = '';
	storageAccountId = '';
	memberId = '';

	constructor(
		harness: Harness,
		key: TestKey,
		readonly encKey: TestKey,
	) {
		super(harness, key);
	}

	protected authHeaders(): Record<string, string> {
		return this.accessTokenValue
			? { authorization: `DPoP ${this.accessTokenValue}`, 'skillpouch-client': 'cli/test' }
			: { 'skillpouch-client': 'cli/test' };
	}

	protected accessToken(): string | undefined {
		return this.accessTokenValue || undefined;
	}

	/** Same client without credentials (for public endpoints like the token redeem). */
	anonymous(): CliClient {
		const clone = new CliClient(this.harness, this.key, this.encKey);
		return clone;
	}
}

/** Creates a user through Better Auth's test utilities and returns a signed-in, bound browser. */
export async function signIn(
	harness: Harness,
	email: string,
	options: { bind?: boolean; emailVerified?: boolean } = {},
): Promise<BrowserClient> {
	const context = (await harness.deps.auth.$context) as unknown as {
		test: {
			createUser(input: Record<string, unknown>): { id: string };
			saveUser(user: { id: string }): Promise<{ id: string }>;
			login(input: { userId: string }): Promise<{ headers: Headers }>;
		};
	};
	const { rows } = await harness.owner.query('SELECT id FROM users WHERE email = $1', [email]);
	let userId = rows[0]?.id as string | undefined;
	if (!userId) {
		const user = context.test.createUser({
			email,
			name: email.split('@')[0],
			emailVerified: options.emailVerified ?? true,
		});
		userId = (await context.test.saveUser(user)).id;
	}
	const { headers } = await context.test.login({ userId });
	const cookie = headers.get('cookie') ?? '';
	const browser = new BrowserClient(harness, await TestKey.generate(), cookie, userId, email);
	if (options.bind !== false) await browser.bind();
	return browser;
}
