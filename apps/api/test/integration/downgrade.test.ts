// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Downgrades and storage limits (plan 09 §3, 18 §3.3).
 *
 *  - Pouches beyond the plan limit become `locked`: the web can still read
 *    them (and delete items in them); CLI devices can neither sync them nor
 *    switch to them. The user picks which pouch stays active.
 *  - Over the storage limit, new bytes are refused everywhere but deletes
 *    always go through, and "Free up space" removes older versions now.
 *  - Nothing is ever deleted automatically.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { refreshEntitlements } from '../../src/modules/entitlements/entitlements.service';
import type { CliClient } from '../helpers/clients';
import { randomBlobId } from '../helpers/e2ee';
import { authorizeCli, createPouch, newId, setupAccount, type Account } from '../helpers/flows';
import { createHarness, type Harness } from '../helpers/harness';
import { commitOne, nameIndex, pouchState, uploadBlobs, type Writer } from '../helpers/sync';

interface PouchView {
	id: string;
	state: string;
}

describe('downgrade: locked pouches and storage limits', () => {
	let h: Harness;
	let alice: Account;
	let bob: Account;
	let cli: CliClient;
	let web: Writer;
	let device: Writer;
	let p1: string;
	let p2: string;
	let p3: string;
	/** Artifact in p1 with two versions (has history). */
	let skill: { id: string; head: string };
	/** Two artifacts in p2. */
	let keep: string;
	let trash: { id: string; head: string };

	/** Per-user limits through the override row, then the normal recompute path. */
	async function setLimits(pouchLimit: number | null, storageBytes: number | null) {
		await h.owner.query(
			`INSERT INTO entitlement_overrides (storage_account_id, pouch_limit, storage_bytes, updated_by)
			 VALUES ($1, $2, $3, $4)
			 ON CONFLICT (storage_account_id) DO UPDATE SET pouch_limit = $2, storage_bytes = $3`,
			[alice.accountId, pouchLimit, storageBytes, alice.browser.userId],
		);
		await refreshEntitlements(h.deps.db.app, alice.accountId);
	}

	async function clearLimits() {
		await h.owner.query('DELETE FROM entitlement_overrides WHERE storage_account_id = $1', [
			alice.accountId,
		]);
		await refreshEntitlements(h.deps.db.app, alice.accountId);
	}

	async function states(): Promise<Record<string, string>> {
		const list = (await alice.browser.get('/v1/pouches')).body.data.pouches as PouchView[];
		return Object.fromEntries(list.map((pouch) => [pouch.id, pouch.state]));
	}

	async function epochOf(pouchId: string) {
		return (await pouchState(alice.browser, pouchId)).epoch;
	}

	async function storage() {
		return (await alice.browser.get('/v1/account/storage')).body.data as {
			used_bytes: number;
			quota_bytes: number;
			over_quota_since: string | null;
			pouches: {
				id: string;
				state: string;
				bytes: number;
				history_bytes: number;
				artifacts: {
					id: string;
					deleted: boolean;
					head_bytes: number;
					history_bytes: number;
				}[];
			}[];
		};
	}

	beforeAll(async () => {
		h = await createHarness();
		alice = await setupAccount(h, 'alice@skillpouch.test');
		bob = await setupAccount(h, 'bob@skillpouch.test');
		cli = await authorizeCli(h, alice);
		web = {
			client: alice.browser,
			memberId: alice.browserMember.id,
			key: alice.browserMember.key,
		};
		device = { client: cli, memberId: cli.memberId, key: cli.key };

		// Supporter-sized account with three pouches and some content.
		await setLimits(3, 1024 * 1024 * 1024);
		p1 = alice.pouchId;
		const second = await createPouch(alice);
		expect(second.status).toBe(200);
		p2 = second.body.data.id;
		const third = await createPouch(alice);
		p3 = third.body.data.id;

		const [v1] = await uploadBlobs(cli, p1);
		const created = await commitOne(device, p1, await epochOf(p1), {
			type: 'create',
			artifactId: newId(),
			baseRevisionId: null,
			nameIndex: nameIndex(),
			blobIds: [v1!.id],
		});
		const [v2] = await uploadBlobs(cli, p1);
		const updated = await commitOne(device, p1, await epochOf(p1), {
			type: 'update',
			artifactId: created.artifact_id,
			baseRevisionId: created.revision_id,
			blobIds: [v2!.id],
		});
		skill = { id: created.artifact_id, head: updated.revision_id };

		const e2 = await epochOf(p2);
		const [b1] = await uploadBlobs(cli, p2);
		keep = (
			await commitOne(device, p2, e2, {
				type: 'create',
				artifactId: newId(),
				baseRevisionId: null,
				nameIndex: nameIndex(),
				blobIds: [b1!.id],
			})
		).artifact_id;
		const [b2] = await uploadBlobs(cli, p2);
		const t = await commitOne(device, p2, e2, {
			type: 'create',
			artifactId: newId(),
			baseRevisionId: null,
			nameIndex: nameIndex(),
			blobIds: [b2!.id],
		});
		trash = { id: t.artifact_id, head: t.revision_id };

		const [b3] = await uploadBlobs(cli, p3);
		await commitOne(device, p3, await epochOf(p3), {
			type: 'create',
			artifactId: newId(),
			baseRevisionId: null,
			nameIndex: nameIndex(),
			blobIds: [b3!.id],
		});
	});
	afterAll(async () => {
		await h.close();
	});

	describe('locked pouches', () => {
		it('downgrade keeps the oldest pouch active, locks the rest and deletes nothing', async () => {
			await clearLimits();
			expect(await states()).toEqual({ [p1]: 'active', [p2]: 'locked', [p3]: 'locked' });
			const items = await alice.browser.get(`/v1/pouches/${p2}/artifacts`);
			expect(items.status).toBe(200);
			expect(items.body.data.items).toHaveLength(2);
		});

		it('the CLI can see a locked pouch but cannot sync it or switch to it', async () => {
			const e2 = await epochOf(p2);
			const blocked = [
				await cli.get(`/v1/pouches/${p2}/events?after=0&epoch=${e2}`),
				await cli.post(`/v1/pouches/${p2}/snapshots`),
				await cli.post(`/v1/pouches/${p2}/blobs/check`, {
					blobs: [{ id: randomBlobId(), stored_size: 100 }],
				}),
				await cli.put('/v1/devices/me/active-pouch', { pouch_id: p2 }),
				await cli.put('/v1/devices/me/cursor', { pouch_id: p2, epoch: e2, acked_seq: 0 }),
				await cli.get(`/v1/pouches/${p2}/artifacts`),
			];
			for (const response of blocked) {
				expect(response.status).toBe(409);
				expect(response.body.error.code).toBe('pouch_locked');
			}
			const visible = await cli.get(`/v1/pouches/${p2}`);
			expect(visible.status).toBe(200);
			expect(visible.body.data.state).toBe('locked');
			expect(
				(await cli.get(`/v1/pouches/${p1}/events?after=0&epoch=${await epochOf(p1)}`))
					.status,
			).toBe(200);
			expect((await cli.put('/v1/devices/me/active-pouch', { pouch_id: p1 })).status).toBe(
				200,
			);
		});

		it('the web reads a locked pouch, cannot add to it, but may delete items in it', async () => {
			const e2 = await epochOf(p2);
			const upload = await alice.browser.post(`/v1/pouches/${p2}/blobs/check`, {
				blobs: [{ id: randomBlobId(), stored_size: 100 }],
			});
			expect(upload.body.error.code).toBe('pouch_locked');
			await expect(
				commitOne(web, p2, e2, {
					type: 'create',
					artifactId: newId(),
					baseRevisionId: null,
					nameIndex: nameIndex(),
				}),
			).rejects.toThrow(/pouch_locked/);
			const deleted = await commitOne(web, p2, e2, {
				type: 'delete',
				artifactId: trash.id,
				baseRevisionId: trash.head,
			});
			expect(deleted.status).toBe('applied');
		});

		it('"Make active" swaps which pouch is active, and the choice survives a recompute', async () => {
			const refused = await alice.browser.post(`/v1/pouches/${p2}/activate`, {});
			expect(refused.status).toBe(403);
			expect(refused.body.error.code).toBe('pouch_limit_reached');
			expect(refused.body.error.details.active_pouch_ids).toEqual([p1]);

			const swapped = await alice.browser.post(`/v1/pouches/${p2}/activate`, {
				lock_pouch_id: p1,
			});
			expect(swapped.status).toBe(200);
			expect(await states()).toEqual({ [p1]: 'locked', [p2]: 'active', [p3]: 'locked' });
			expect(
				(await cli.get(`/v1/pouches/${p1}/events?after=0&epoch=${await epochOf(p1)}`)).body
					.error.code,
			).toBe('pouch_locked');

			await refreshEntitlements(h.deps.db.app, alice.accountId);
			expect((await states())[p2]).toBe('active');

			// Back to p1 for the rest of the suite.
			await alice.browser.post(`/v1/pouches/${p1}/activate`, { lock_pouch_id: p2 });
			expect((await states())[p1]).toBe('active');
		});

		it('only the web can choose the active pouch', async () => {
			// Session-only route: a CLI token is not a web session (401).
			expect(
				(await cli.post(`/v1/pouches/${p2}/activate`, { lock_pouch_id: p1 })).status,
			).toBe(401);
		});

		it('upgrading again unlocks every pouch at once', async () => {
			await setLimits(3, 1024 * 1024 * 1024);
			expect(await states()).toEqual({ [p1]: 'active', [p2]: 'active', [p3]: 'active' });
			await clearLimits();
			expect(await states()).toEqual({ [p1]: 'active', [p2]: 'locked', [p3]: 'locked' });
		});
	});

	describe('over the storage limit', () => {
		it('reports sizes per pouch and per item, including what history holds', async () => {
			const usage = await storage();
			expect(usage.pouches.map((pouch) => pouch.id)).toEqual([p1, p2, p3]);
			const first = usage.pouches[0]!;
			expect(first.bytes).toBeGreaterThan(0);
			expect(first.history_bytes).toBeGreaterThan(0);
			const item = first.artifacts.find((artifact) => artifact.id === skill.id)!;
			expect(item.head_bytes).toBeGreaterThan(0);
			expect(item.history_bytes).toBeGreaterThan(0);
			const sum = usage.pouches.reduce((total, pouch) => total + pouch.bytes, 0);
			expect(sum).toBe(usage.used_bytes);
		});

		it('refuses new bytes but always accepts deletes', async () => {
			const before = await storage();
			const historyP1 = before.pouches[0]!.history_bytes;
			await setLimits(null, before.used_bytes - Math.floor(historyP1 / 2));
			const usage = await storage();
			expect(usage.over_quota_since).not.toBeNull();

			const check = await cli.post(`/v1/pouches/${p1}/blobs/check`, {
				blobs: [{ id: randomBlobId(), stored_size: 100 }],
			});
			expect(check.body.error.code).toBe('quota_exceeded');
			await expect(
				commitOne(device, p1, await epochOf(p1), {
					type: 'create',
					artifactId: newId(),
					baseRevisionId: null,
					nameIndex: nameIndex(),
				}),
			).rejects.toThrow(/quota_exceeded/);
		});

		it('"Old versions & trash" frees the history of a pouch and lifts the limit', async () => {
			const freed = await alice.browser.post(`/v1/pouches/${p1}/free-space`, {});
			expect(freed.status).toBe(200);
			expect(freed.body.data.freed_bytes).toBeGreaterThan(0);
			expect(freed.body.data.over_quota).toBe(false);
			const usage = await storage();
			expect(usage.over_quota_since).toBeNull();
			expect(usage.pouches[0]!.history_bytes).toBe(0);
			// The current version is untouched.
			const items = await alice.browser.get(`/v1/pouches/${p1}/artifacts`);
			expect(items.body.data.items.map((a: { id: string }) => a.id)).toContain(skill.id);
			const { rows } = await h.owner.query(
				'SELECT id FROM revisions WHERE artifact_id = $1',
				[skill.id],
			);
			expect(rows.map((row) => row.id)).toEqual([skill.head]);
		});

		it('frees deleted items one by one — only once they are deleted', async () => {
			const notDeleted = await alice.browser.post(`/v1/pouches/${p2}/free-space`, {
				artifact_ids: [keep],
			});
			expect(notDeleted.status).toBe(409);
			expect(notDeleted.body.error.code).toBe('artifact_not_deleted');
			expect(
				(
					await alice.browser.post(`/v1/pouches/${p2}/free-space`, {
						artifact_ids: [newId()],
					})
				).status,
			).toBe(404);

			const before = (await storage()).pouches[1]!;
			expect(before.artifacts.find((a) => a.id === trash.id)!.history_bytes).toBeGreaterThan(
				0,
			);
			const freed = await alice.browser.post(`/v1/pouches/${p2}/free-space`, {
				artifact_ids: [trash.id],
			});
			expect(freed.status).toBe(200);
			expect(freed.body.data.freed_bytes).toBeGreaterThan(0);
			const after = (await storage()).pouches[1]!;
			expect(after.artifacts.find((a) => a.id === trash.id)!.history_bytes).toBe(0);
			expect(after.artifacts.find((a) => a.id === keep)!.head_bytes).toBeGreaterThan(0);
		});

		it('deleting a pouch with skip_undo frees its space immediately', async () => {
			const before = await storage();
			const p3Bytes = before.pouches.find((pouch) => pouch.id === p3)!.bytes;
			const response = await alice.browser.delete(`/v1/pouches/${p3}?skip_undo=true`);
			expect(response.status).toBe(200);
			const after = await storage();
			expect(after.pouches.map((pouch) => pouch.id)).not.toContain(p3);
			expect(after.used_bytes).toBe(before.used_bytes - p3Bytes);
			expect(existsSync(join(h.blobRoot, alice.accountId, p3))).toBe(false);
		});
	});

	describe('isolation', () => {
		it('another account can neither see nor touch these pouches (404)', async () => {
			expect((await bob.browser.post(`/v1/pouches/${p1}/free-space`, {})).status).toBe(404);
			expect(
				(await bob.browser.post(`/v1/pouches/${p2}/activate`, { lock_pouch_id: p1 }))
					.status,
			).toBe(404);
			const bobUsage = (await bob.browser.get('/v1/account/storage')).body.data;
			expect(bobUsage.pouches.map((pouch: { id: string }) => pouch.id)).toEqual([
				bob.pouchId,
			]);
		});

		it('storage details are web-only', async () => {
			expect((await cli.get('/v1/account/storage')).status).toBe(401);
		});
	});
});
