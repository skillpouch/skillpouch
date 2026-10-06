// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Authentication end to end through the HTTP API: browser session binding
 *, account genesis, "Authorize CLI", DPoP-bound
 * tokens, refresh rotation + reuse detection and web revoke.
 */
import { cliConfirmCode } from '../../src/modules/cli-auth/cli-auth.service';
import { createHash, randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CliClient, signIn } from '../helpers/clients';
import { authorizeCli, setupAccount, type Account } from '../helpers/flows';
import { createHarness, type Harness } from '../helpers/harness';
import { TestKey } from '../helpers/keys';

describe('authentication', () => {
	let h: Harness;
	let account: Account;

	beforeAll(async () => {
		h = await createHarness();
		account = await setupAccount(h, 'alice@skillpouch.test');
	});
	afterAll(async () => {
		await h.close();
	});

	describe('browser session binding', () => {
		it('rejects an unbound session on normal routes', async () => {
			const browser = await signIn(h, 'unbound@skillpouch.test', { bind: false });
			const response = await browser.get('/v1/pouches', { noDpop: true });
			expect(response.body.error.code).toBe('session_unbound');
		});

		it('binds once, then requires a proof from that key', async () => {
			const browser = await signIn(h, 'binder@skillpouch.test', { bind: false });
			await browser.bind();
			expect((await browser.post('/v1/session/bind')).body.error.code).toBe(
				'session_already_bound',
			);
			expect((await browser.get('/v1/pouches')).status).toBe(200);
			expect((await browser.get('/v1/pouches', { noDpop: true })).body.error.code).toBe(
				'dpop_invalid',
			);
			const otherKey = await TestKey.generate();
			expect((await browser.get('/v1/pouches', { dpopKey: otherKey })).body.error.code).toBe(
				'dpop_invalid',
			);
		});

		it('rejects a stolen cookie used from another browser (no key)', async () => {
			const thief = await signIn(h, 'alice@skillpouch.test', { bind: false });
			thief.cookie = account.browser.cookie;
			const response = await thief.get('/v1/pouches', { dpopKey: await TestKey.generate() });
			expect(response.status).toBe(401);
		});

		it('rejects cross-site writes (Origin / Skillpouch-Client)', async () => {
			const response = await account.browser.post(
				'/v1/pouches',
				{},
				{ headers: { origin: 'https://evil.example' } },
			);
			expect(response.body.error.code).toBe('csrf_rejected');
		});

		it('refuses replayed DPoP proofs', async () => {
			const nonce = (await account.browser.get('/v1/dpop/nonce')).body.data.nonce;
			const proof = await account.browser.key.dpop(
				'GET',
				'http://localhost:8080/v1/pouches',
				{ nonce },
			);
			const send = () =>
				h.app.inject({
					method: 'GET',
					url: '/v1/pouches',
					headers: { cookie: account.browser.cookie, dpop: proof },
				});
			expect((await send()).statusCode).toBe(200);
			expect((await send()).json().error.code).toBe('dpop_replay');
		});

		it('demands the server nonce and stale iat fails', async () => {
			const proof = await account.browser.key.dpop('GET', 'http://localhost:8080/v1/pouches');
			const response = await h.app.inject({
				method: 'GET',
				url: '/v1/pouches',
				headers: { cookie: account.browser.cookie, dpop: proof },
			});
			expect(response.json().error.code).toBe('dpop_nonce_required');
			expect(response.headers['dpop-nonce']).toBeTruthy();
			const nonce = String(response.headers['dpop-nonce']);
			const stale = await account.browser.key.dpop(
				'GET',
				'http://localhost:8080/v1/pouches',
				{
					nonce,
					iat: Math.floor(Date.now() / 1000) - 600,
				},
			);
			const staleResponse = await h.app.inject({
				method: 'GET',
				url: '/v1/pouches',
				headers: { cookie: account.browser.cookie, dpop: stale },
			});
			expect(staleResponse.json().error).toMatchObject({
				code: 'dpop_invalid',
				details: { reason: 'iat' },
			});
		});

		it('rejects a proof for a different URL (htu)', async () => {
			const nonce = (await account.browser.get('/v1/dpop/nonce')).body.data.nonce;
			const proof = await account.browser.key.dpop(
				'GET',
				'http://localhost:8080/v1/devices',
				{ nonce },
			);
			const response = await h.app.inject({
				method: 'GET',
				url: '/v1/pouches',
				headers: { cookie: account.browser.cookie, dpop: proof },
			});
			expect(response.json().error.details.reason).toBe('htu');
		});
	});

	describe('account genesis', () => {
		it('created the first pouch and both members', async () => {
			const pouches = (await account.browser.get('/v1/pouches')).body.data.pouches;
			expect(pouches).toHaveLength(1);
			expect(pouches[0]).toMatchObject({
				id: account.pouchId,
				state: 'active',
				key_gen: 1,
				event_seq: 0,
			});
			const members = (await account.browser.get('/v1/account/members')).body.data.members;
			expect(members.map((m: { kind: string }) => m.kind).sort()).toEqual([
				'browser',
				'password',
				'recovery',
			]);
			const roster = (await account.browser.get('/v1/account/roster')).body.data;
			expect(roster.head_seq).toBe(1);
			expect(roster.genesis_hash).toBe(roster.statements[0].statement_hash);
		});

		it('cannot run twice', async () => {
			const response = await account.browser.post('/v1/account/roster/genesis', {
				statements: [
					{ statement: 'e30', signature: 'AA' },
					{ statement: 'e30', signature: 'AA' },
				],
				key_envelopes: [],
			});
			expect(response.status).toBeGreaterThanOrEqual(400);
		});
	});

	describe('Authorize CLI', () => {
		it('logs a CLI in with one click and gives it a working DPoP-bound token', async () => {
			const cli = await authorizeCli(h, account);
			const list = await cli.get('/v1/devices');
			expect(list.status).toBe(200);
			expect(list.body.data.devices).toHaveLength(1);
			expect(list.body.data.devices[0]).toMatchObject({
				name: 'laptop',
				state: 'active',
				key_storage: 'file',
				is_current: true,
			});
			const envelopes = await cli.get('/v1/account/key-envelopes');
			expect(envelopes.body.data.key_envelopes).toHaveLength(1);
		});

		it('rejects a stolen access token used without the device key', async () => {
			const cli = await authorizeCli(h, account, 'stolen');
			const thief = new CliClient(h, await TestKey.generate(), await TestKey.generate());
			thief.accessTokenValue = cli.accessTokenValue;
			const response = await thief.get('/v1/devices');
			expect(response.body.error.code).toBe('dpop_invalid');
			const bearer = await h.app.inject({
				method: 'GET',
				url: '/v1/devices',
				headers: { authorization: `Bearer ${cli.accessTokenValue}` },
			});
			expect(bearer.statusCode).toBe(401);
		});

		async function openRequest(cli: CliClient, verifier: string) {
			return cli.post('/v1/cli-auth/requests', {
				code_challenge: createHash('sha256').update(verifier).digest('base64url'),
				device_name: 'box',
				os: 'macos',
				arch: 'arm64',
				cli_version: '0.1.0',
				sign_pub: cli.key.jwk,
				enc_pub: cli.encKey.jwk,
				key_storage: 'secure_enclave',
			});
		}

		it('requires the DPoP proof to come from the announced key', async () => {
			const cli = new CliClient(h, await TestKey.generate(), await TestKey.generate());
			const response = await cli.post('/v1/cli-auth/requests', {
				code_challenge: createHash('sha256').update('x'.repeat(43)).digest('base64url'),
				device_name: 'box',
				os: 'linux',
				arch: 'x64',
				cli_version: '0.1.0',
				sign_pub: (await TestKey.generate()).jwk,
				enc_pub: cli.encKey.jwk,
				key_storage: 'file',
			});
			expect(response.body.error.code).toBe('dpop_invalid');
		});

		it('returns pending until approved, and rejects wrong verifier / wrong key', async () => {
			const cli = new CliClient(h, await TestKey.generate(), await TestKey.generate());
			const verifier = randomBytes(32).toString('base64url');
			const created = await openRequest(cli, verifier);
			const requestId = created.body.data.request_id;
			expect(created.body.data.authorize_url).toBe(
				`http://localhost:5173/cli/authorize?request=${requestId}`,
			);

			const pending = await cli.post('/v1/cli-auth/token', {
				request_id: requestId,
				code_verifier: verifier,
			});
			expect(pending.body.data).toEqual({ status: 'pending', interval: 2 });

			const wrongVerifier = await cli.post('/v1/cli-auth/token', {
				request_id: requestId,
				code_verifier: randomBytes(32).toString('base64url'),
			});
			expect(wrongVerifier.body.error.code).toBe('pkce_invalid');

			const thief = new CliClient(h, await TestKey.generate(), await TestKey.generate());
			const wrongKey = await thief.post('/v1/cli-auth/token', {
				request_id: requestId,
				code_verifier: verifier,
			});
			expect(wrongKey.body.error.code).toBe('dpop_invalid');

			const view = await account.browser.get(`/v1/cli-auth/requests/${requestId}`);
			expect(view.body.data).toMatchObject({
				device_name: 'box',
				os: 'macos',
				state: 'open',
				jkt: cli.key.jkt,
			});
		});

		it('deny is final', async () => {
			const cli = new CliClient(h, await TestKey.generate(), await TestKey.generate());
			const verifier = randomBytes(32).toString('base64url');
			const requestId = (await openRequest(cli, verifier)).body.data.request_id;
			expect(
				(await account.browser.post(`/v1/cli-auth/requests/${requestId}/deny`)).status,
			).toBe(200);
			const token = await cli.post('/v1/cli-auth/token', {
				request_id: requestId,
				code_verifier: verifier,
			});
			expect(token.body.error.code).toBe('cli_auth_denied');
		});

		it('a link login cannot be approved without the code from the terminal (phishing)', async () => {
			// The attacker opens a request with their own keys and sends the link to the victim.
			const attacker = new CliClient(h, await TestKey.generate(), await TestKey.generate());
			const verifier = randomBytes(32).toString('base64url');
			const requestId = (await openRequest(attacker, verifier)).body.data.request_id;
			const approve = (confirm_code?: string) =>
				account.browser.post(`/v1/cli-auth/requests/${requestId}/approve`, {
					statement: { statement: 'e30', signature: 'AA' },
					welcome: 'AA',
					key_envelopes: [],
					...(confirm_code ? { confirm_code } : {}),
				});
			// Checked before the roster statement is even parsed.
			for (const code of [undefined, '0000-0000', '12345678']) {
				const refused = await approve(code);
				expect(refused.body.error?.code).toBe('cli_auth_code_mismatch');
			}
			const { rows } = await h.owner.query(
				'SELECT state, device_id FROM cli_auth_requests WHERE id = $1',
				[requestId],
			);
			expect(rows[0]).toEqual({ state: 'open', device_id: null });
		});

		it('the server’s confirm code matches the one the browser and CLI compute', async () => {
			const { confirmCode } = await import('@skillpouch/crypto');
			const key = await TestKey.generate();
			const enc = await TestKey.generate();
			const id = '0192f0c4-1111-7000-8000-000000000001';
			expect(cliConfirmCode({ id, signPub: key.jwk, encPub: enc.jwk, jkt: key.jkt })).toBe(
				confirmCode(id, key.jwk as never, enc.jwk as never, key.jkt),
			);
		});

		it('another user cannot see or approve someone else’s approved request', async () => {
			const other = await setupAccount(h, 'mallory@skillpouch.test');
			const cli = await authorizeCli(h, account, 'victim-cli');
			const { rows } = await h.owner.query(
				'SELECT id FROM cli_auth_requests WHERE device_id = $1',
				[cli.deviceId],
			);
			const response = await other.browser.get(`/v1/cli-auth/requests/${rows[0].id}`);
			expect(response.status).toBe(404);
		});

		it('a redeemed request cannot be redeemed again', async () => {
			const cli = await authorizeCli(h, account, 'once');
			const { rows } = await h.owner.query(
				'SELECT id FROM cli_auth_requests WHERE device_id = $1',
				[cli.deviceId],
			);
			const again = await cli.anonymous().post('/v1/cli-auth/token', {
				request_id: rows[0].id,
				code_verifier: 'x'.repeat(43),
			});
			expect(again.body.error.code).toBe('pkce_invalid');
		});
	});

	describe('refresh tokens', () => {
		it('rotate on use and revoke the device on reuse', async () => {
			const cli = await authorizeCli(h, account, 'refresher');
			const first = cli.refreshToken;
			const refreshed = await cli
				.anonymous()
				.post('/v1/devices/token', { refresh_token: first });
			expect(refreshed.status).toBe(200);
			expect(refreshed.body.data.refresh_token).not.toBe(first);

			const reused = await cli
				.anonymous()
				.post('/v1/devices/token', { refresh_token: first });
			expect(reused.body.error.code).toBe('refresh_reused');

			const afterReuse = await cli.get('/v1/devices');
			expect(afterReuse.body.error.code).toBe('device_revoked');
			const events = (await account.browser.get('/v1/security/events')).body;
			expect(JSON.stringify(events)).toContain('refresh_reuse');
		});

		it('requires the device key', async () => {
			const cli = await authorizeCli(h, account, 'refresh-key');
			const thief = new CliClient(h, await TestKey.generate(), await TestKey.generate());
			const response = await thief.post('/v1/devices/token', {
				refresh_token: cli.refreshToken,
			});
			expect(response.body.error.code).toBe('dpop_invalid');
		});
	});

	describe('revoke from the web', () => {
		it('stops the CLI on its very next request, even with an unexpired token', async () => {
			const cli = await authorizeCli(h, account, 'to-revoke');
			expect((await cli.get('/v1/devices')).status).toBe(200);
			const revoke = await account.browser.post(`/v1/devices/${cli.deviceId}/revoke`, {});
			expect(revoke.body.data).toEqual({ revoked: true, rotation_pending: true });
			expect((await cli.get('/v1/devices')).body.error.code).toBe('device_revoked');
			const refresh = await cli
				.anonymous()
				.post('/v1/devices/token', { refresh_token: cli.refreshToken });
			expect(refresh.body.error.code).toBe('device_revoked');
		});

		it('is a 404 for another account’s device', async () => {
			const other = await setupAccount(h, 'eve@skillpouch.test');
			const cli = await authorizeCli(h, account, 'not-yours');
			const response = await other.browser.post(`/v1/devices/${cli.deviceId}/revoke`, {});
			expect(response.status).toBe(404);
			expect((await cli.get('/v1/devices')).status).toBe(200);
		});

		it('requires a fresh sign-in (step-up) for web sessions', async () => {
			const cli = await authorizeCli(h, account, 'stepup');
			await h.owner.query(
				`UPDATE sessions SET step_up_at = now() - interval '1 hour' WHERE jkt = $1`,
				[account.browser.key.jkt],
			);
			const response = await account.browser.post(`/v1/devices/${cli.deviceId}/revoke`, {});
			expect(response.body.error.code).toBe('step_up_required');
			await h.owner.query(`UPDATE sessions SET step_up_at = now() WHERE jkt = $1`, [
				account.browser.key.jkt,
			]);
		});
	});
});
