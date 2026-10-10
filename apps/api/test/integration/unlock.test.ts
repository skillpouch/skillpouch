// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Unlocking content in a new browser: master
 * password (pepper, throttling, grants), Recovery Key, passkey PRF unlockers,
 * trusted-browser enrollment and expiry, roster invariants, password change.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { signIn, type BrowserClient } from '../helpers/clients';
import {
	keyEnvelope,
	memberJson,
	newMember,
	rosterHead,
	statement,
	type MemberHandle,
} from '../helpers/e2ee';
import { setupAccount, type Account } from '../helpers/flows';
import { createHarness, WEB_ORIGIN, type Harness } from '../helpers/harness';
import { SoftAuthenticator } from '../helpers/webauthn';

/** Envelopes for every active member at `keyGen` of every live pouch. */
async function envelopesForAll(
	client: BrowserClient,
	keyGen: (pouch: { key_gen: number }) => number,
	createdBy: string,
	extra: string[] = [],
) {
	const members = (await client.get('/v1/account/members')).body.data.members as {
		id: string;
		removed_seq: number | null;
	}[];
	const pouches = (await client.get('/v1/pouches')).body.data.pouches as {
		id: string;
		key_gen: number;
		state: string;
	}[];
	const ids = [...members.filter((m) => m.removed_seq === null).map((m) => m.id), ...extra];
	return pouches
		.filter((pouch) => pouch.state !== 'deleted')
		.flatMap((pouch) => ids.map((id) => keyEnvelope(pouch.id, id, keyGen(pouch), createdBy)));
}

async function generations(client: BrowserClient) {
	const pouches = (await client.get('/v1/pouches')).body.data.pouches as {
		id: string;
		key_gen: number;
	}[];
	return Object.fromEntries(pouches.map((pouch) => [pouch.id, pouch.key_gen + 1]));
}

/** A fresh browser of the same user: signed in + bound, not yet a member. */
async function newBrowser(h: Harness, account: Account): Promise<BrowserClient> {
	return signIn(h, account.browser.email);
}

/** Enrolls `browser`, signing the `add` with `unlocking`. */
async function enroll(account: Account, browser: BrowserClient, unlocking: MemberHandle) {
	const member = await newMember('browser', browser.key);
	const head = await rosterHead(account.browser);
	const add = await statement(unlocking, account.accountId, head, {
		action: 'add',
		member: memberJson(member),
	});
	const envelopes = await envelopesForAll(
		account.browser,
		(pouch) => pouch.key_gen,
		unlocking.id,
		[member.id],
	);
	const response = await browser.post('/v1/account/browsers/enroll', {
		statements: [add],
		key_envelopes: envelopes.filter((envelope) => envelope.member_id === member.id),
	});
	return { response, member };
}

describe('unlock', () => {
	let h: Harness;
	let alice: Account;

	beforeAll(async () => {
		h = await createHarness();
		alice = await setupAccount(h, 'alice@skillpouch.test');
	});
	afterAll(async () => {
		await h.close();
	});

	describe('setup', () => {
		it('genesis needs prepared master-password parameters', async () => {
			const browser = await signIn(h, 'nosetup@skillpouch.test');
			expect((await browser.get('/v1/account/unlock/params')).body.data.state).toBe(
				'setup_required',
			);
			const response = await browser.post('/v1/account/roster/genesis', {
				statements: [
					{ statement: 'e30', signature: 'AA' },
					{ statement: 'e30', signature: 'AA' },
				],
				key_envelopes: [],
			});
			expect(response.status).toBeGreaterThanOrEqual(400);
		});

		it('publishes KDF params and the secret-derived members in unlock order', async () => {
			const params = (await alice.browser.get('/v1/account/unlock/params')).body.data;
			expect(params).toMatchObject({
				state: 'ready',
				kdf_params: { alg: 'argon2id', m: 65536, t: 3, p: 1 },
				browser_trust_days: 30,
				failed_streak: 0,
			});
			expect(params.members).toEqual([
				{
					id: alice.passwordMember.id,
					kind: 'password',
					member_salt: alice.passwordMember.salt,
				},
				{
					id: alice.recoveryMember.id,
					kind: 'recovery',
					member_salt: alice.recoveryMember.salt,
				},
			]);
		});

		it('never stores the pepper in plaintext', async () => {
			const { rows } = await h.owner.query(
				'SELECT pepper_ciphertext FROM account_unlock WHERE storage_account_id = $1',
				[alice.accountId],
			);
			expect(rows[0].pepper_ciphertext.length).toBe(24 + 32 + 16);
		});
	});

	describe('master password on a new browser', () => {
		it('withholds password envelopes until the pepper was released to this session', async () => {
			const browser = await newBrowser(h, alice);
			const url = `/v1/account/unlock/envelopes?member_id=${alice.passwordMember.id}`;
			expect((await browser.get(url)).body.error.code).toBe('unlock_grant_required');
			const pepper = await browser.post('/v1/account/unlock/pepper');
			expect(pepper.status).toBe(200);
			expect(Buffer.from(pepper.body.data.pepper, 'base64url')).toHaveLength(32);
			const envelopes = await browser.get(url);
			expect(envelopes.body.data.key_envelopes).toEqual([
				expect.objectContaining({
					pouch_id: alice.pouchId,
					member_id: alice.passwordMember.id,
					key_gen: 1,
				}),
			]);
		});

		it('releases the same pepper each time (it is the account’s, not the session’s)', async () => {
			const a = await (await newBrowser(h, alice)).post('/v1/account/unlock/pepper');
			const b = await (await newBrowser(h, alice)).post('/v1/account/unlock/pepper');
			expect(a.body.data.pepper).toBe(b.body.data.pepper);
		});

		it('enrolls the browser with an add signed by the password member', async () => {
			const browser = await newBrowser(h, alice);
			expect((await browser.get('/v1/account/key-envelopes')).body.error.code).toBe(
				'member_inactive',
			);
			const { response, member } = await enroll(alice, browser, alice.passwordMember);
			expect(response.status).toBe(200);
			expect(response.body.data.member_id).toBe(member.id);
			const own = await browser.get('/v1/account/key-envelopes');
			expect(own.body.data.key_envelopes).toHaveLength(1);
			const events = await alice.browser.get('/v1/security/events');
			expect(JSON.stringify(events.body.data)).toContain('browser.trusted');
		});

		it('refuses an enrollment signed by anything but a secret-derived member', async () => {
			const browser = await newBrowser(h, alice);
			const { response } = await enroll(alice, browser, alice.browserMember);
			expect(response.body.error.code).toBe('member_inactive');
		});

		it('refuses to enroll a key that is not this session’s key', async () => {
			const browser = await newBrowser(h, alice);
			const other = await newBrowser(h, alice);
			const member = await newMember('browser', other.key);
			const head = await rosterHead(alice.browser);
			const add = await statement(alice.passwordMember, alice.accountId, head, {
				action: 'add',
				member: memberJson(member),
			});
			const response = await browser.post('/v1/account/browsers/enroll', {
				statements: [add],
				key_envelopes: [],
			});
			expect(response.body.error.code).toBe('roster_invalid');
		});

		it('counts wrong passwords and raises an alert at five', async () => {
			let streak = 0;
			for (let i = 0; i < 5; i++)
				streak = (await alice.browser.post('/v1/account/unlock/failed')).body.data
					.failed_streak;
			expect(streak).toBe(5);
			const { rows } = await h.owner.query(
				`SELECT 1 FROM security_events WHERE storage_account_id = $1 AND kind = 'unlock.failed_streak'`,
				[alice.accountId],
			);
			expect(rows).toHaveLength(1);
		});
	});

	describe('pepper throttling', () => {
		it('allows 10 releases per hour per account, then 429', async () => {
			const carol = await setupAccount(h, 'carol@skillpouch.test');
			const statuses: number[] = [];
			for (let i = 0; i < 11; i++)
				statuses.push((await carol.browser.post('/v1/account/unlock/pepper')).status);
			expect(statuses.slice(0, 10).every((status) => status === 200)).toBe(true);
			const last = await carol.browser.post('/v1/account/unlock/pepper');
			expect(last.status).toBe(429);
			expect(last.body.error.code).toBe('unlock_rate_limited');
			expect(last.headers['retry-after']).toBeTruthy();
		});
	});

	describe('Recovery Key', () => {
		it('releases recovery envelopes without a grant (256-bit secret) and enrolls', async () => {
			const browser = await newBrowser(h, alice);
			const envelopes = await browser.get(
				`/v1/account/unlock/envelopes?member_id=${alice.recoveryMember.id}`,
			);
			expect(envelopes.status).toBe(200);
			const { response } = await enroll(alice, browser, alice.recoveryMember);
			expect(response.status).toBe(200);
		});

		it('replaces the Recovery Key (add new + remove old + rotate) but never just removes it', async () => {
			const head = await rosterHead(alice.browser);
			const removeOnly = await statement(
				alice.browserMember,
				alice.accountId,
				{ ...head },
				{ action: 'remove', member_id: alice.recoveryMember.id },
			);
			const rejected = await alice.browser.post('/v1/account/roster', {
				statements: [removeOnly],
				key_envelopes: [],
			});
			expect(rejected.body.error).toMatchObject({ code: 'roster_invalid' });

			const fresh = await newMember('recovery');
			const add = await statement(alice.browserMember, alice.accountId, head, {
				action: 'add',
				member: memberJson(fresh),
			});
			const remove = await statement(alice.browserMember, alice.accountId, head, {
				action: 'remove',
				member_id: alice.recoveryMember.id,
			});
			const gens = await generations(alice.browser);
			const rotate = await statement(alice.browserMember, alice.accountId, head, {
				action: 'rotate_keys',
				new_generations: gens,
			});
			const envelopes = (
				await envelopesForAll(
					alice.browser,
					(pouch) => pouch.key_gen + 1,
					alice.browserMember.id,
					[fresh.id],
				)
			).filter((envelope) => envelope.member_id !== alice.recoveryMember.id);
			const response = await alice.browser.post('/v1/account/roster', {
				statements: [add, remove, rotate],
				key_envelopes: envelopes,
			});
			expect(response.status).toBe(200);
			alice.recoveryMember = fresh;
			const params = (await alice.browser.get('/v1/account/unlock/params')).body.data;
			expect(params.members.find((m: { kind: string }) => m.kind === 'recovery').id).toBe(
				fresh.id,
			);
		});
	});

	describe('trusted browsers', () => {
		it('expires trust after the window, then a secret proof renews it', async () => {
			const browser = await newBrowser(h, alice);
			const { member } = await enroll(alice, browser, alice.passwordMember);
			await h.owner.query(
				`UPDATE account_members SET last_seen_at = now() - interval '31 days' WHERE id = $1`,
				[member.id],
			);
			expect((await browser.get('/v1/account/key-envelopes')).body.error.code).toBe(
				'browser_trust_expired',
			);

			const message = Buffer.concat([
				Buffer.from(member.id),
				Buffer.from('|'),
				Buffer.from(browser.key.jkt),
			]);
			const forged = await browser.post('/v1/account/browsers/renew-trust', {
				signer_member_id: alice.passwordMember.id,
				signature: await browser.key.sign('skillpouch/v1/renew-trust', message),
			});
			expect(forged.body.error.code).toBe('signature_invalid');
			const renewed = await browser.post('/v1/account/browsers/renew-trust', {
				signer_member_id: alice.passwordMember.id,
				signature: await alice.passwordMember.key.sign(
					'skillpouch/v1/renew-trust',
					message,
				),
			});
			expect(renewed.status).toBe(200);
			expect((await browser.get('/v1/account/key-envelopes')).status).toBe(200);
		});

		it('lets the user choose a trust window between 7 and 90 days', async () => {
			expect(
				(
					await alice.browser.patch('/v1/account/security-settings', {
						browser_trust_days: 3,
					})
				).status,
			).toBe(400);
			const updated = await alice.browser.patch('/v1/account/security-settings', {
				browser_trust_days: 14,
			});
			expect(updated.body.data).toEqual({ browser_trust_days: 14, auto_lock_minutes: 30 });
			expect(
				(await alice.browser.get('/v1/account/unlock/params')).body.data.browser_trust_days,
			).toBe(14);
		});
	});

	describe('master password change', () => {
		it('commits new params with add(new) + remove(old); the old grant dies', async () => {
			const before = (await alice.browser.get('/v1/account/unlock/params')).body.data;
			const prepared = await alice.browser.post('/v1/account/unlock/prepare');
			expect(prepared.status).toBe(200);
			expect(prepared.body.data.kdf_salt).not.toBe(before.kdf_salt);

			const fresh = await newMember('password');
			const head = await rosterHead(alice.browser);
			const add = await statement(alice.browserMember, alice.accountId, head, {
				action: 'add',
				member: memberJson(fresh),
			});
			const remove = await statement(alice.browserMember, alice.accountId, head, {
				action: 'remove',
				member_id: alice.passwordMember.id,
			});
			const response = await alice.browser.put('/v1/account/unlock', {
				statements: [add, remove],
				key_envelopes: (
					await envelopesForAll(
						alice.browser,
						(pouch) => pouch.key_gen,
						alice.browserMember.id,
						[fresh.id],
					)
				).filter((envelope) => envelope.member_id === fresh.id),
			});
			expect(response.status).toBe(200);
			const after = (await alice.browser.get('/v1/account/unlock/params')).body.data;
			expect(after.kdf_salt).toBe(prepared.body.data.kdf_salt);
			expect(after.members.find((m: { kind: string }) => m.kind === 'password').id).toBe(
				fresh.id,
			);
			const browser = await newBrowser(h, alice);
			const pepper = await browser.post('/v1/account/unlock/pepper');
			expect(pepper.body.data.pepper).toBe(prepared.body.data.pepper);
			alice.passwordMember = fresh;
		});
	});

	describe('passkeys (PRF unlock)', () => {
		let authenticator: SoftAuthenticator;
		let passkeyMember: MemberHandle;
		let passkeyId: string;

		const staleStepUp = (account: Account) =>
			h.owner.query(
				`UPDATE sessions SET step_up_at = now() - interval '1 hour' WHERE jkt = $1`,
				[account.browser.key.jkt],
			);
		const freshStepUp = (account: Account) =>
			h.owner.query(`UPDATE sessions SET step_up_at = now() WHERE jkt = $1`, [
				account.browser.key.jkt,
			]);

		/** Registration options → soft authenticator → `add(passkey)` + envelopes. */
		async function registerPasskey(account: Account, device: SoftAuthenticator, label: string) {
			const options = await account.browser.post('/v1/account/passkeys/options');
			const member = await newMember('passkey');
			const head = await rosterHead(account.browser);
			const add = await statement(account.browserMember, account.accountId, head, {
				action: 'add',
				member: memberJson(member),
			});
			const response = await account.browser.post('/v1/account/passkeys', {
				response: device.register(options.body.data.options),
				label,
				statement: add,
				key_envelopes: (
					await envelopesForAll(
						account.browser,
						(pouch) => pouch.key_gen,
						account.browserMember.id,
						[member.id],
					)
				).filter((envelope) => envelope.member_id === member.id),
			});
			return { options, member, response };
		}

		it('adding a passkey needs a fresh sign-in (step-up)', async () => {
			await staleStepUp(alice);
			const options = await alice.browser.post('/v1/account/passkeys/options');
			expect(options.body.error.code).toBe('step_up_required');
			const register = await alice.browser.post('/v1/account/passkeys', {
				response: {},
				statement: { statement: 'e30', signature: 'AA' },
			});
			expect(register.body.error.code).toBe('step_up_required');
			await freshStepUp(alice);
		});

		it('registers a passkey together with its signed add statement', async () => {
			authenticator = new SoftAuthenticator(WEB_ORIGIN, 'localhost');
			const { options, member, response } = await registerPasskey(
				alice,
				authenticator,
				'Test key',
			);
			expect(options.body.data.options.extensions).toMatchObject({ prf: {} });
			expect(response.status).toBe(200);
			passkeyMember = member;
			passkeyId = response.body.data.id;
			const params = (await alice.browser.get('/v1/account/unlock/params')).body.data;
			expect(params.members[0]).toMatchObject({ id: passkeyMember.id, kind: 'passkey' });
			expect(params.passkeys).toEqual([
				expect.objectContaining({ id: passkeyId, label: 'Test key' }),
			]);
			// The passkey's envelopes are ordinary HPKE envelopes: ciphertext only.
			const { rows } = await h.owner.query(
				'SELECT count(*)::int AS n FROM key_envelopes WHERE member_id = $1',
				[passkeyMember.id],
			);
			expect(rows[0].n).toBeGreaterThan(0);
			const events = await h.owner.query(
				`SELECT details FROM security_events WHERE storage_account_id = $1 AND kind = 'passkey.added'`,
				[alice.accountId],
			);
			expect(events.rows).toEqual([
				{ details: { member_id: passkeyMember.id, label: 'Test key' } },
			]);
		});

		it('refuses a passkey member added through the generic roster route', async () => {
			const head = await rosterHead(alice.browser);
			const add = await statement(alice.browserMember, alice.accountId, head, {
				action: 'add',
				member: memberJson(await newMember('passkey')),
			});
			const response = await alice.browser.post('/v1/account/roster', {
				statements: [add],
				key_envelopes: [],
			});
			expect(response.body.error.code).toBe('roster_invalid');
		});

		it('unlocks a new browser: assertion → envelopes → enroll signed by the passkey member', async () => {
			const browser = await newBrowser(h, alice);
			const url = `/v1/account/unlock/envelopes?member_id=${passkeyMember.id}`;
			expect((await browser.get(url)).body.error.code).toBe('unlock_grant_required');
			const options = await browser.post('/v1/account/passkeys/assert-options');
			expect(options.body.data.options.allowCredentials).toEqual([
				expect.objectContaining({ id: authenticator.credentialId.toString('base64url') }),
			]);
			const assertion = authenticator.assert(options.body.data.options);
			const verified = await browser.post('/v1/account/passkeys/assert', {
				response: assertion,
			});
			expect(verified.body.data.member_id).toBe(passkeyMember.id);
			// A challenge verifies once.
			expect(
				(await browser.post('/v1/account/passkeys/assert', { response: assertion })).body
					.error.code,
			).toBe('webauthn_invalid');
			expect((await browser.get(url)).status).toBe(200);
			const { response } = await enroll(alice, browser, passkeyMember);
			expect(response.status).toBe(200);
		});

		it('refuses an assertion that carries the PRF output', async () => {
			const browser = await newBrowser(h, alice);
			const options = await browser.post('/v1/account/passkeys/assert-options');
			const response = await browser.post('/v1/account/passkeys/assert', {
				response: authenticator.assert(options.body.data.options, { leakPrf: true }),
			});
			expect(response.body.error.code).toBe('webauthn_invalid');
			expect(
				(await browser.get(`/v1/account/unlock/envelopes?member_id=${passkeyMember.id}`))
					.body.error.code,
			).toBe('unlock_grant_required');
		});

		it('rejects an assertion from an unknown authenticator', async () => {
			const browser = await newBrowser(h, alice);
			const options = await browser.post('/v1/account/passkeys/assert-options');
			const stranger = new SoftAuthenticator(WEB_ORIGIN, 'localhost');
			const response = await browser.post('/v1/account/passkeys/assert', {
				response: stranger.assert(options.body.data.options),
			});
			expect(response.body.error.code).toBe('webauthn_invalid');
		});

		it('renames a passkey (unlocked browsers only)', async () => {
			const renamed = await alice.browser.patch(`/v1/account/passkeys/${passkeyId}`, {
				label: '  YubiKey  ',
			});
			expect(renamed.body.data).toMatchObject({ id: passkeyId, label: 'YubiKey' });
			expect(
				(await alice.browser.patch(`/v1/account/passkeys/${passkeyId}`, { label: '' }))
					.status,
			).toBe(400);
			const locked = await newBrowser(h, alice);
			expect(
				(await locked.patch(`/v1/account/passkeys/${passkeyId}`, { label: 'Mine' })).body
					.error.code,
			).toBe('member_inactive');
		});

		it('keeps every account’s passkeys to itself', async () => {
			const bob = await setupAccount(h, 'bob-passkeys@skillpouch.test');
			expect((await bob.browser.post('/v1/account/passkeys/assert-options')).status).toBe(
				404,
			);
			expect((await bob.browser.get('/v1/account/unlock/params')).body.data.passkeys).toEqual(
				[],
			);
			expect(
				(await bob.browser.patch(`/v1/account/passkeys/${passkeyId}`, { label: 'x' }))
					.status,
			).toBe(404);
			expect(
				(
					await bob.browser.get(
						`/v1/account/unlock/envelopes?member_id=${passkeyMember.id}`,
					)
				).status,
			).toBe(404);
			const bobsHead = await rosterHead(bob.browser);
			const remove = await statement(bob.browserMember, bob.accountId, bobsHead, {
				action: 'remove',
				member_id: passkeyMember.id,
			});
			const removal = await bob.browser.delete(`/v1/account/passkeys/${passkeyId}`, {
				body: { statements: [remove], key_envelopes: [] },
			});
			expect(removal.status).toBe(404);

			// Bob's own passkey works for Bob; Alice's authenticator can't answer Bob's challenge.
			const bobsDevice = new SoftAuthenticator(WEB_ORIGIN, 'localhost');
			expect((await registerPasskey(bob, bobsDevice, 'Bob key')).response.status).toBe(200);
			const options = await bob.browser.post('/v1/account/passkeys/assert-options');
			expect(options.body.data.options.allowCredentials).toEqual([
				expect.objectContaining({ id: bobsDevice.credentialId.toString('base64url') }),
			]);
			const crossed = await bob.browser.post('/v1/account/passkeys/assert', {
				response: authenticator.assert(options.body.data.options),
			});
			expect(crossed.body.error.code).toBe('webauthn_invalid');
			expect(
				(await alice.browser.get('/v1/account/unlock/params')).body.data.passkeys,
			).toHaveLength(1);
		});

		it('removing a passkey needs step-up and remove + rotate_keys', async () => {
			const head = await rosterHead(alice.browser);
			const remove = await statement(
				alice.browserMember,
				alice.accountId,
				{ ...head },
				{ action: 'remove', member_id: passkeyMember.id },
			);
			await staleStepUp(alice);
			const stale = await alice.browser.delete(`/v1/account/passkeys/${passkeyId}`, {
				body: { statements: [remove], key_envelopes: [] },
			});
			expect(stale.body.error.code).toBe('step_up_required');
			await freshStepUp(alice);

			const without = await alice.browser.delete(`/v1/account/passkeys/${passkeyId}`, {
				body: { statements: [remove], key_envelopes: [] },
			});
			expect(without.body.error.code).toBe('roster_invalid');

			const removeAgain = await statement(alice.browserMember, alice.accountId, head, {
				action: 'remove',
				member_id: passkeyMember.id,
			});
			const rotate = await statement(alice.browserMember, alice.accountId, head, {
				action: 'rotate_keys',
				new_generations: await generations(alice.browser),
			});
			const envelopes = (
				await envelopesForAll(
					alice.browser,
					(pouch) => pouch.key_gen + 1,
					alice.browserMember.id,
				)
			).filter((envelope) => envelope.member_id !== passkeyMember.id);
			const response = await alice.browser.delete(`/v1/account/passkeys/${passkeyId}`, {
				body: { statements: [removeAgain, rotate], key_envelopes: envelopes },
			});
			expect(response.status).toBe(200);
			expect(
				(await alice.browser.get('/v1/account/unlock/params')).body.data.passkeys,
			).toEqual([]);
			const { rows } = await h.owner.query(
				`SELECT
					(SELECT count(*)::int FROM unlock_grants WHERE member_id = $1) AS grants,
					(SELECT count(*)::int FROM security_events
						WHERE storage_account_id = $2 AND kind = 'passkey.removed') AS events`,
				[passkeyMember.id, alice.accountId],
			);
			expect(rows[0]).toEqual({ grants: 0, events: 1 });
			// The removed member's envelopes open nothing for a new session.
			const browser = await newBrowser(h, alice);
			expect(
				(await browser.get(`/v1/account/unlock/envelopes?member_id=${passkeyMember.id}`))
					.status,
			).toBe(404);
		});
	});

	describe('tenant isolation', () => {
		it("cannot fetch another account's unlock envelopes", async () => {
			const bob = await setupAccount(h, 'bob@skillpouch.test');
			const response = await bob.browser.get(
				`/v1/account/unlock/envelopes?member_id=${alice.recoveryMember.id}`,
			);
			expect(response.status).toBe(404);
		});
	});
});
