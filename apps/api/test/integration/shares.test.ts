// SPDX-License-Identifier: AGPL-3.0-only
/** Share links: owner lifecycle, public and one-time access, quota and isolation. */
import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { expireShares } from '../../src/jobs/housekeeping';
import { signIn } from '../helpers/clients';
import { newId, setupAccount, type Account } from '../helpers/flows';
import { createHarness, type Harness } from '../helpers/harness';

describe('share links', () => {
	let h: Harness;
	let alice: Account;
	let bob: Account;

	beforeAll(async () => {
		h = await createHarness();
		alice = await setupAccount(h, 'alice@skillpouch.test');
		bob = await setupAccount(h, 'bob@skillpouch.test');
	});
	afterAll(async () => {
		await h.close();
	});

	const sealed = (size = 300) => randomBytes(size).toString('base64url');

	async function share(
		options: { one_time?: boolean; expires?: string; size?: number; account?: Account } = {},
	) {
		const account = options.account ?? alice;
		const id = newId();
		const response = await account.browser.post(`/v1/pouches/${account.pouchId}/shares`, {
			id,
			bundle: sealed(options.size),
			label_enc: sealed(40),
			one_time: options.one_time ?? false,
			expires: options.expires ?? '7d',
		});
		expect(response.status, JSON.stringify(response.body)).toBe(200);
		return response.body.data as { id: string; size: number; state: string };
	}

	async function usedBytes(account: Account = alice): Promise<number> {
		return (await account.browser.get('/v1/account/storage')).body.data.used_bytes;
	}

	const publicGet = (url: string) => h.app.inject({ method: 'GET', url });

	it('creates a link, counts its ciphertext in storage and lists it', async () => {
		const before = await usedBytes();
		const created = await share({ size: 1000 });
		expect(created).toMatchObject({ state: 'active', size: 1000 });
		expect(await usedBytes()).toBe(before + 1000);

		const list = await alice.browser.get('/v1/shares');
		expect(list.body.data.shares[0]).toMatchObject({ id: created.id, views: 0, imports: 0 });
	});

	it('lets anyone with the link read metadata and download a reusable bundle', async () => {
		const created = await share();
		const meta = await publicGet(`/v1/public/shares/${created.id}`);
		expect(meta.json().data).toMatchObject({ state: 'active', one_time: false, size: 300 });

		const bundle = await publicGet(`/v1/public/shares/${created.id}/bundle`);
		expect(bundle.statusCode).toBe(200);
		expect(bundle.headers['content-type']).toBe('application/octet-stream');
		expect(bundle.rawPayload.length).toBe(300);

		expect((await bob.browser.post(`/v1/shares/${created.id}/imported`)).status).toBe(200);
		const listed = (await alice.browser.get('/v1/shares')).body.data.shares.find(
			(row: { id: string }) => row.id === created.id,
		);
		expect(listed).toMatchObject({ views: 1, imports: 1 });
		expect(listed.last_imported_at).not.toBeNull();
	});

	it('answers unknown links with 404', async () => {
		expect((await publicGet(`/v1/public/shares/${newId()}`)).statusCode).toBe(404);
		expect((await publicGet(`/v1/public/shares/${newId()}/bundle`)).statusCode).toBe(404);
		expect((await publicGet('/v1/public/shares/not-a-uuid')).statusCode).toBe(400);
	});

	it('revoking deletes the ciphertext and frees the space', async () => {
		const created = await share({ size: 500 });
		const before = await usedBytes();
		const revoked = await alice.browser.post(`/v1/shares/${created.id}/revoke`);
		expect(revoked.body.data).toMatchObject({ state: 'revoked', size: 0 });
		expect(await usedBytes()).toBe(before - 500);

		const bundle = await publicGet(`/v1/public/shares/${created.id}/bundle`);
		expect(bundle.statusCode).toBe(410);
		expect(bundle.json().error).toMatchObject({
			code: 'share_unavailable',
			details: { state: 'revoked' },
		});
		const { rows } = await h.owner.query(
			'SELECT octet_length(ciphertext) AS n FROM shares WHERE id = $1',
			[created.id],
		);
		expect(rows[0].n).toBe(0);
		// Revoking twice is harmless.
		expect((await alice.browser.post(`/v1/shares/${created.id}/revoke`)).status).toBe(200);
	});

	it('hands a one-time bundle out exactly once, to a signed-in recipient', async () => {
		const created = await share({ one_time: true, size: 400 });
		const before = await usedBytes();

		const anonymous = await publicGet(`/v1/public/shares/${created.id}/bundle`);
		expect(anonymous.statusCode).toBe(403);
		const unauthenticated = await h.app.inject({
			method: 'POST',
			url: `/v1/shares/${created.id}/claim`,
		});
		expect(unauthenticated.statusCode).toBe(401);

		const claims = await Promise.all([
			bob.browser.post(`/v1/shares/${created.id}/claim`),
			bob.browser.post(`/v1/shares/${created.id}/claim`),
		]);
		const ok = claims.filter((claim) => claim.status === 200);
		expect(ok).toHaveLength(1);
		expect(Buffer.from(ok[0]!.body.data.bundle, 'base64url').length).toBe(400);
		const refused = claims.find((claim) => claim.status !== 200)!;
		expect(refused.body.error).toMatchObject({
			code: 'share_unavailable',
			details: { state: 'consumed' },
		});

		expect(await usedBytes()).toBe(before - 400);
		const meta = await publicGet(`/v1/public/shares/${created.id}`);
		expect(meta.json().data.state).toBe('consumed');
		expect((await bob.browser.post(`/v1/shares/${created.id}/imported`)).status).toBe(410);
	});

	it('expires links and the job gives their bytes back', async () => {
		const created = await share({ expires: '1d', size: 700 });
		const before = await usedBytes();
		await h.owner.query(
			"UPDATE shares SET expires_at = now() - interval '1 minute' WHERE id = $1",
			[created.id],
		);
		const bundle = await publicGet(`/v1/public/shares/${created.id}/bundle`);
		expect(bundle.json().error.details.state).toBe('expired');

		expect(await expireShares(h.deps)).toBeGreaterThanOrEqual(1);
		expect(await usedBytes()).toBe(before - 700);
		expect(await expireShares(h.deps)).toBe(0);
	});

	it('supports links that never expire', async () => {
		const created = await share({ expires: 'never' });
		const meta = await publicGet(`/v1/public/shares/${created.id}`);
		expect(meta.json().data.expires_at).toBeNull();
	});

	it('keeps every account’s links private', async () => {
		const created = await share();
		const bobs = (await bob.browser.get('/v1/shares')).body.data.shares;
		expect(bobs.map((row: { id: string }) => row.id)).not.toContain(created.id);
		expect((await bob.browser.post(`/v1/shares/${created.id}/revoke`)).status).toBe(404);

		const intoAlice = await bob.browser.post(`/v1/pouches/${alice.pouchId}/shares`, {
			id: newId(),
			bundle: sealed(),
			label_enc: sealed(40),
		});
		expect(intoAlice.status).toBe(404);
	});

	it('lets a recipient transaction see exactly the one named share', async () => {
		await share();
		const client = await h.owner.connect();
		try {
			const target = (await client.query('SELECT id FROM shares LIMIT 1')).rows[0].id;
			await client.query('BEGIN');
			await client.query('SET LOCAL ROLE sp_app');
			await client.query(
				"SELECT set_config('app.sa_id', '00000000-0000-0000-0000-000000000000', true), set_config('app.share_id', $1, true)",
				[target],
			);
			const visible = await client.query('SELECT id FROM shares');
			expect(visible.rows.map((row) => row.id)).toEqual([target]);
			const otherTables = await client.query('SELECT count(*)::int AS n FROM pouches');
			expect(otherTables.rows[0].n).toBe(0);
			await client.query('ROLLBACK');
		} finally {
			client.release();
		}
	});

	it('refuses links over the quota, too large, reused ids and malformed input', async () => {
		await h.owner.query(
			'UPDATE storage_accounts SET quota_bytes = used_bytes + 100 WHERE id = $1',
			[bob.accountId],
		);
		const over = await bob.browser.post(`/v1/pouches/${bob.pouchId}/shares`, {
			id: newId(),
			bundle: sealed(200),
			label_enc: sealed(40),
		});
		expect(over.body.error.code).toBe('quota_exceeded');
		await h.owner.query('UPDATE storage_accounts SET quota_bytes = 104857600 WHERE id = $1', [
			bob.accountId,
		]);

		const created = await share();
		const reused = await alice.browser.post(`/v1/pouches/${alice.pouchId}/shares`, {
			id: created.id,
			bundle: sealed(),
			label_enc: sealed(40),
		});
		expect(reused.body.error.code).toBe('precondition_failed');

		for (const body of [
			{ id: newId(), bundle: '', label_enc: sealed(40) },
			{ id: newId(), bundle: sealed(), label_enc: sealed(600) },
			{ id: newId(), bundle: sealed(), label_enc: sealed(40), expires: '2y' },
			{ id: 'nope', bundle: sealed(), label_enc: sealed(40) },
		]) {
			const response = await alice.browser.post(`/v1/pouches/${alice.pouchId}/shares`, body);
			expect(response.status, JSON.stringify(body)).toBe(400);
		}
	});

	it('refuses links from a locked pouch and from a locked browser', async () => {
		await h.owner.query("UPDATE pouches SET state = 'locked' WHERE id = $1", [bob.pouchId]);
		const locked = await bob.browser.post(`/v1/pouches/${bob.pouchId}/shares`, {
			id: newId(),
			bundle: sealed(),
			label_enc: sealed(40),
		});
		expect(locked.body.error.code).toBe('pouch_locked');
		await h.owner.query("UPDATE pouches SET state = 'active' WHERE id = $1", [bob.pouchId]);

		const notUnlocked = await signIn(h, 'stranger@skillpouch.test');
		const refused = await notUnlocked.post(`/v1/pouches/${alice.pouchId}/shares`, {
			id: newId(),
			bundle: sealed(),
			label_enc: sealed(40),
		});
		expect(refused.body.error.code).toBe('member_inactive');
	});

	it('keeps usage consistent with a full recalculation', async () => {
		const before = await usedBytes();
		const { recalcAccountUsage } = await import('../../src/jobs/purge');
		await h.deps.db.maintenance.transaction((tx) => recalcAccountUsage(tx, alice.accountId));
		expect(await usedBytes()).toBe(before);
	});

	it('the nightly usage recount counts share bundles too (no false drift)', async () => {
		await share({ size: 5000 });
		const before = await usedBytes();
		const { recalcUsage } = await import('../../src/jobs/housekeeping');
		await recalcUsage(h.deps);
		expect(await usedBytes()).toBe(before);
	});
});
