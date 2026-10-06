// SPDX-License-Identifier: AGPL-3.0-only
/** Development sign-in: only when DEV_LOGIN is on, never in production. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadEnv } from '../../src/config/env';
import { createHarness, type Harness } from '../helpers/harness';

describe('dev login', () => {
	let enabled: Harness;
	let disabled: Harness;

	beforeAll(async () => {
		[enabled, disabled] = await Promise.all([
			createHarness({
				DEV_LOGIN: 'true',
				GITHUB_CLIENT_ID: 'gh-client',
				GITHUB_CLIENT_SECRET: 'gh-secret',
			}),
			createHarness(),
		]);
	});
	afterAll(async () => {
		await Promise.all([enabled.close(), disabled.close()]);
	});

	async function login(harness: Harness, email: string) {
		return harness.app.inject({
			method: 'POST',
			url: '/v1/dev/login',
			payload: { email },
		});
	}

	it('starts a real session and creates the storage account', async () => {
		const response = await login(enabled, 'Dev@Example.test');
		expect(response.statusCode).toBe(200);
		const cookie = String(response.headers['set-cookie']);
		expect(cookie).toMatch(/HttpOnly/);
		const userId = response.json().data.user_id;

		const me = await enabled.app.inject({
			method: 'GET',
			url: '/v1/auth/get-session',
			headers: { cookie: cookie.split(';')[0]! },
		});
		expect(me.json().user.email).toBe('dev@example.test');
		const { rows } = await enabled.owner.query(
			'SELECT count(*)::int AS n FROM storage_accounts WHERE owner_user_id = $1',
			[userId],
		);
		expect(rows[0].n).toBe(1);
	});

	it('mounts Better Auth: OAuth start returns the provider URL, sign-out ends the session', async () => {
		const start = await enabled.app.inject({
			method: 'POST',
			url: '/v1/auth/sign-in/social',
			headers: { origin: 'http://localhost:5173' },
			payload: { provider: 'github', callbackURL: 'http://localhost:5173/app' },
		});
		expect(start.statusCode).toBe(200);
		expect(start.json().url).toMatch(/^https:\/\/github\.com\/login\/oauth\/authorize\?/);
		expect(String(start.headers['set-cookie'])).toMatch(/sp\.state|oauth_state|sp\./);

		const cookie = String(
			(await login(enabled, 'out@example.test')).headers['set-cookie'],
		).split(';')[0]!;
		const out = await enabled.app.inject({
			method: 'POST',
			url: '/v1/auth/sign-out',
			headers: { cookie, origin: 'http://localhost:5173' },
			payload: {},
		});
		expect(out.statusCode).toBe(200);
		const after = await enabled.app.inject({
			method: 'GET',
			url: '/v1/auth/get-session',
			headers: { cookie },
		});
		expect(after.json()).toBeNull();
	});

	it('reuses the existing user for the same email', async () => {
		const first = (await login(enabled, 'same@example.test')).json().data.user_id;
		const second = (await login(enabled, 'same@example.test')).json().data.user_id;
		expect(second).toBe(first);
	});

	it('rejects malformed bodies', async () => {
		const response = await enabled.app.inject({
			method: 'POST',
			url: '/v1/dev/login',
			payload: { email: 'not-an-email' },
		});
		expect(response.statusCode).toBe(400);
	});

	it('does not exist unless enabled', async () => {
		expect((await login(disabled, 'x@example.test')).statusCode).toBe(404);
	});

	it('cannot be enabled in production', () => {
		expect(() =>
			loadEnv({
				NODE_ENV: 'production',
				DATABASE_URL: 'postgres://x/y',
				DEV_LOGIN: 'true',
				BETTER_AUTH_SECRET: 'b'.repeat(40),
				DPOP_NONCE_SECRET: 'd'.repeat(40),
				IP_HASH_SECRET: 'i'.repeat(40),
				PEPPER_KEY: 'cHJvZC1wZXBwZXIta2V5LTMyLWJ5dGVzLWxvbmctISE',
				JWT_SIGNING_KEY: '{"kty":"OKP","crv":"Ed25519","x":"x","d":"d"}',
				SECRETS_DIR: '/nonexistent',
			}),
		).toThrow(/DEV_LOGIN/);
	});
});
