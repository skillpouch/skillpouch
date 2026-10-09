// SPDX-License-Identifier: AGPL-3.0-only
/** Deleting pouches: never the last one; deleted ones can be purged right away. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { refreshEntitlements } from '../../src/modules/entitlements/entitlements.service';
import { createPouch, setupAccount, type Account } from '../helpers/flows';
import { createHarness, type Harness } from '../helpers/harness';

interface PouchView {
	id: string;
	state: string;
	delete_after: string | null;
}

describe('deleting pouches', () => {
	let h: Harness;
	let alice: Account;
	let second: string;

	async function pouches(): Promise<PouchView[]> {
		return (await alice.browser.get('/v1/pouches')).body.data.pouches;
	}

	beforeAll(async () => {
		h = await createHarness();
		alice = await setupAccount(h, 'alice@skillpouch.test');
		await h.owner.query(
			`INSERT INTO entitlement_overrides (storage_account_id, pouch_limit, updated_by)
			 VALUES ($1, 3, $2)`,
			[alice.accountId, alice.browser.userId],
		);
		await refreshEntitlements(h.deps.db.app, alice.accountId);
		const created = await createPouch(alice);
		expect(created.status).toBe(200);
		second = created.body.data.id;
	});

	afterAll(async () => {
		await h?.close();
	});

	it('keeps a deleted pouch for the undo window', async () => {
		const response = await alice.browser.delete(`/v1/pouches/${second}`);
		expect(response.status).toBe(200);
		expect(response.body.data.state).toBe('deleted');
		expect(response.body.data.delete_after).not.toBeNull();
		expect((await pouches()).find((pouch) => pouch.id === second)?.state).toBe('deleted');
	});

	it('refuses to delete the only pouch left', async () => {
		const response = await alice.browser.delete(`/v1/pouches/${alice.pouchId}`);
		expect(response.status).toBe(409);
		expect(response.body.error.code).toBe('last_pouch');
		const again = await alice.browser.delete(`/v1/pouches/${alice.pouchId}?skip_undo=true`);
		expect(again.body.error.code).toBe('last_pouch');
		expect((await pouches()).find((pouch) => pouch.id === alice.pouchId)?.state).toBe('active');
	});

	it('deletes a pouch in its undo window permanently', async () => {
		const response = await alice.browser.delete(`/v1/pouches/${second}?skip_undo=true`);
		expect(response.status).toBe(200);
		expect((await pouches()).map((pouch) => pouch.id)).not.toContain(second);
		const purged = await h.owner.query(
			`SELECT count(*)::int AS n FROM audit_log WHERE action = 'pouch.purged' AND target = $1`,
			[second],
		);
		expect(purged.rows[0].n).toBe(1);
	});

	it('a second plain delete of a deleted pouch is not found', async () => {
		const created = await createPouch(alice);
		const id = created.body.data.id as string;
		expect((await alice.browser.delete(`/v1/pouches/${id}`)).status).toBe(200);
		expect((await alice.browser.delete(`/v1/pouches/${id}`)).status).toBe(404);
	});
});
