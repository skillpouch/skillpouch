// SPDX-License-Identifier: AGPL-3.0-only
/** "Connect a computer": one-time tokens for `npx skillpouch login <token>`. */
import { createHash, randomBytes } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CliClient, signIn } from '../helpers/clients';
import { authorizeCli, setupAccount, type Account } from '../helpers/flows';
import { createHarness, type Harness } from '../helpers/harness';
import { TestKey } from '../helpers/keys';

describe('connect tokens', () => {
	let h: Harness;
	let alice: Account;
	let mallory: Account;

	beforeAll(async () => {
		h = await createHarness();
		alice = await setupAccount(h, 'alice@skillpouch.test');
		mallory = await setupAccount(h, 'mallory@skillpouch.test');
	});
	afterAll(async () => {
		await h.close();
	});

	async function newToken(account: Account = alice) {
		const response = await account.browser.post('/v1/cli-auth/connect-tokens');
		expect(response.status, JSON.stringify(response.body)).toBe(200);
		return response.body.data as { id: string; token: string; command: string };
	}

	/** Step 1 of `skillpouch login <token>`, without authorizing. */
	async function startLogin(token: string) {
		const cli = new CliClient(h, await TestKey.generate(), await TestKey.generate());
		const verifier = randomBytes(32).toString('base64url');
		return cli.post('/v1/cli-auth/requests', {
			code_challenge: createHash('sha256').update(verifier).digest('base64url'),
			device_name: 'laptop',
			os: 'linux',
			arch: 'x64',
			cli_version: '0.1.0',
			sign_pub: cli.key.jwk,
			enc_pub: cli.encKey.jwk,
			key_storage: 'file',
			connect_token: token,
		});
	}

	it('issues a one-time token with a ready-to-paste command', async () => {
		const token = await newToken();
		expect(token.token).toMatch(/^sp_lt_[A-Za-z0-9_-]{32}$/);
		expect(token.command).toBe(`npx skillpouch login ${token.token}`);
		const status = await alice.browser.get(`/v1/cli-auth/connect-tokens/${token.id}`);
		expect(status.body.data).toMatchObject({ state: 'waiting', request_id: null });
	});

	it('stores only a hash of the token', async () => {
		const token = await newToken();
		const { rows } = await h.owner.query(
			'SELECT token_hash FROM cli_connect_tokens WHERE id = $1',
			[token.id],
		);
		expect(Buffer.from(rows[0].token_hash).toString('hex')).toBe(
			createHash('sha256').update(token.token).digest('hex'),
		);
		const dump = await h.owner.query(
			'SELECT row_to_json(t)::text AS j FROM cli_connect_tokens t',
		);
		expect(dump.rows.map((row) => row.j).join('')).not.toContain(token.token);
	});

	it('links the CLI request to the account and tells the waiting browser', async () => {
		const listener = new pg.Client({ connectionString: h.database.url });
		await listener.connect();
		const events: { sa: string; type: string; data: Record<string, string> }[] = [];
		listener.on('notification', (message) => events.push(JSON.parse(message.payload!)));
		await listener.query('LISTEN account_events');
		try {
			const token = await newToken();
			const created = await startLogin(token.token);
			expect(created.status).toBe(200);
			const requestId = created.body.data.request_id as string;

			const status = await alice.browser.get(`/v1/cli-auth/connect-tokens/${token.id}`);
			expect(status.body.data).toMatchObject({ state: 'requested', request_id: requestId });
			const view = await alice.browser.get(`/v1/cli-auth/requests/${requestId}`);
			expect(view.body.data).toMatchObject({ state: 'open', via_connect_token: true });

			await new Promise((resolve) => setTimeout(resolve, 100));
			expect(events).toContainEqual({
				sa: alice.accountId,
				type: 'cli_auth.requested',
				data: { request_id: requestId, connect_token_id: token.id },
			});
		} finally {
			await listener.end();
		}
	});

	it('logs the CLI in end to end', async () => {
		const token = await newToken();
		const cli = await authorizeCli(h, alice, 'desk', { connectToken: token.token });
		const devices = await alice.browser.get('/v1/devices');
		expect(devices.body.data.devices.map((d: { id: string }) => d.id)).toContain(cli.deviceId);
		expect((await cli.get('/v1/me')).status).toBe(200);
	});

	it('works only once', async () => {
		const token = await newToken();
		expect((await startLogin(token.token)).status).toBe(200);
		const again = await startLogin(token.token);
		expect(again.status).toBe(401);
		expect(again.body.error.code).toBe('connect_token_invalid');
	});

	it('rejects unknown, malformed, expired and revoked tokens', async () => {
		const unknown = await startLogin(`sp_lt_${randomBytes(24).toString('base64url')}`);
		expect(unknown.body.error.code).toBe('connect_token_invalid');

		expect((await startLogin('sp_lt_short')).status).toBe(400);

		const expired = await newToken();
		await h.owner.query(
			"UPDATE cli_connect_tokens SET expires_at = now() - interval '1 second' WHERE id = $1",
			[expired.id],
		);
		expect((await startLogin(expired.token)).body.error.code).toBe('connect_token_invalid');
		const status = await alice.browser.get(`/v1/cli-auth/connect-tokens/${expired.id}`);
		expect(status.body.data.state).toBe('expired');

		const revoked = await newToken();
		expect(
			(await alice.browser.delete(`/v1/cli-auth/connect-tokens/${revoked.id}`)).status,
		).toBe(200);
		expect((await startLogin(revoked.token)).body.error.code).toBe('connect_token_invalid');
	});

	it('keeps tokens and the requests they create invisible to other accounts', async () => {
		const token = await newToken();
		const created = await startLogin(token.token);
		const requestId = created.body.data.request_id as string;

		expect((await mallory.browser.get(`/v1/cli-auth/connect-tokens/${token.id}`)).status).toBe(
			404,
		);
		expect(
			(await mallory.browser.delete(`/v1/cli-auth/connect-tokens/${token.id}`)).status,
		).toBe(404);
		expect((await mallory.browser.get(`/v1/cli-auth/requests/${requestId}`)).status).toBe(404);
		const deny = await mallory.browser.post(`/v1/cli-auth/requests/${requestId}/deny`);
		expect(deny.status).toBe(404);
	});

	it('needs an unlocked browser and caps open tokens per account', async () => {
		const locked = await signIn(h, 'locked@skillpouch.test');
		const refused = await locked.post('/v1/cli-auth/connect-tokens');
		expect(refused.body.error.code).toBe('member_inactive');

		const fresh = await setupAccount(h, 'busy@skillpouch.test');
		for (let i = 0; i < 5; i += 1) await newToken(fresh);
		const sixth = await fresh.browser.post('/v1/cli-auth/connect-tokens');
		expect(sixth.body.error.code).toBe('rate_limited');
	});

	it('requires a signed-in session to create tokens', async () => {
		const anonymous = await h.app.inject({
			method: 'POST',
			url: '/v1/cli-auth/connect-tokens',
		});
		expect(anonymous.statusCode).toBe(401);
	});
});
