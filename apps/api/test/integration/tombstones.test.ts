// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A deleted item's signed delete (its head revision) outlives everything
 * that frees space: "Free up space" for one item or a whole pouch, revision
 * retention, blob GC and event purges. Its files go; the record stays, so a
 * computer that syncs months later still removes its copy instead of sending
 * it back. Only purging the whole pouch removes it.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { gcBlobs } from '../../src/jobs/gc';
import { expireRevisions, purgeEvents } from '../../src/jobs/retention';
import type { CliClient } from '../helpers/clients';
import { authorizeCli, newId, setupAccount, type Account } from '../helpers/flows';
import { createHarness, type Harness } from '../helpers/harness';
import { commitOne, nameIndex, pouchState, uploadBlobs, type Writer } from '../helpers/sync';

interface Listed {
	id: string;
	deleted_at: string | null;
	head: {
		id: string;
		parent_id: string | null;
		signature: string;
		envelope: string;
		blob_ids: string[];
	} | null;
}

describe('signed deletes are kept', () => {
	let h: Harness;
	let alice: Account;
	let cli: CliClient;
	let device: Writer;
	let pouchId: string;
	let epoch: string;

	beforeAll(async () => {
		h = await createHarness();
		alice = await setupAccount(h, 'alice@skillpouch.test');
		cli = await authorizeCli(h, alice);
		device = { client: cli, memberId: cli.memberId, key: cli.key };
		pouchId = alice.pouchId;
		epoch = (await pouchState(cli, pouchId)).epoch;
	});
	afterAll(async () => {
		await h.close();
	});

	/** An item with two versions, then deleted the way clients delete (keeping the entries). */
	async function deletedItem() {
		const [v1] = await uploadBlobs(cli, pouchId);
		const created = await commitOne(device, pouchId, epoch, {
			type: 'create',
			artifactId: newId(),
			baseRevisionId: null,
			nameIndex: nameIndex(),
			blobIds: [v1!.id],
		});
		const [v2] = await uploadBlobs(cli, pouchId);
		const updated = await commitOne(device, pouchId, epoch, {
			type: 'update',
			artifactId: created.artifact_id,
			baseRevisionId: created.revision_id,
			blobIds: [v2!.id],
		});
		const deleted = await commitOne(device, pouchId, epoch, {
			type: 'delete',
			artifactId: created.artifact_id,
			baseRevisionId: updated.revision_id,
			blobIds: [v2!.id],
		});
		expect(deleted.status).toBe('applied');
		return {
			id: created.artifact_id as string,
			parent: updated.revision_id as string,
			tombstone: deleted.revision_id as string,
			blobs: [v1!.id, v2!.id],
		};
	}

	async function liveItem() {
		const [blob] = await uploadBlobs(cli, pouchId);
		const created = await commitOne(device, pouchId, epoch, {
			type: 'create',
			artifactId: newId(),
			baseRevisionId: null,
			nameIndex: nameIndex(),
			blobIds: [blob!.id],
		});
		return {
			id: created.artifact_id as string,
			head: created.revision_id as string,
			blob: blob!.id,
		};
	}

	/** What a computer sees when it lists the pouch, deleted items included. */
	async function listed(id: string): Promise<Listed | undefined> {
		const response = await cli.get(
			`/v1/pouches/${pouchId}/artifacts?include_deleted=true&limit=200`,
		);
		expect(response.status).toBe(200);
		return (response.body.data.items as Listed[]).find((item) => item.id === id);
	}

	async function blobStatus(blobId: string): Promise<number> {
		return (await cli.get(`/v1/pouches/${pouchId}/blobs/${blobId}`)).status;
	}

	async function revisionIds(artifactId: string): Promise<string[]> {
		const { rows } = await h.owner.query<{ id: string }>(
			'SELECT id FROM revisions WHERE artifact_id = $1 ORDER BY created_at',
			[artifactId],
		);
		return rows.map((row) => row.id);
	}

	function expectTombstone(
		item: Listed | undefined,
		before: Listed | undefined,
		tombstone: string,
	) {
		expect(item?.deleted_at).not.toBeNull();
		expect(item?.head?.id).toBe(tombstone);
		// The signed record itself is untouched, parent link included.
		expect(item?.head?.envelope).toBe(before?.head?.envelope);
		expect(item?.head?.signature).toBe(before?.head?.signature);
		expect(item?.head?.parent_id).toBe(before?.head?.parent_id);
	}

	it('"Free up space" for a deleted item frees its files and history, keeps its signed delete', async () => {
		const item = await deletedItem();
		const before = await listed(item.id);
		expect(before?.head?.blob_ids).toEqual([item.blobs[1]]);

		const freed = await alice.browser.post(`/v1/pouches/${pouchId}/free-space`, {
			artifact_ids: [item.id],
		});
		expect(freed.status).toBe(200);
		expect(freed.body.data.freed_bytes).toBeGreaterThan(0);

		const after = await listed(item.id);
		expectTombstone(after, before, item.tombstone);
		expect(after?.head?.parent_id).toBe(item.parent);
		expect(after?.head?.blob_ids).toEqual([]);
		expect(await revisionIds(item.id)).toEqual([item.tombstone]);
		for (const blob of item.blobs) expect(await blobStatus(blob)).toBe(404);
		const usage = (await alice.browser.get('/v1/account/storage')).body.data;
		const sizes = usage.pouches[0].artifacts.find((a: { id: string }) => a.id === item.id);
		expect(sizes.history_bytes).toBe(0);
	});

	it('"Old versions & trash" keeps every signed delete and every live item', async () => {
		const gone = await deletedItem();
		const live = await liveItem();
		const before = await listed(gone.id);

		const freed = await alice.browser.post(`/v1/pouches/${pouchId}/free-space`, {});
		expect(freed.status).toBe(200);

		expectTombstone(await listed(gone.id), before, gone.tombstone);
		for (const blob of gone.blobs) expect(await blobStatus(blob)).toBe(404);
		expect((await listed(live.id))?.head?.id).toBe(live.head);
		expect(await blobStatus(live.blob)).toBe(200);
	});

	it('retention, blob GC and event purges never remove a signed delete', async () => {
		const item = await deletedItem();
		const before = await listed(item.id);
		// Everything due, the head included (as if a bug had dated it too).
		await h.owner.query(
			`UPDATE revisions SET expires_at = now() - interval '1 day' WHERE artifact_id = $1`,
			[item.id],
		);
		await h.owner.query(
			`UPDATE events SET created_at = now() - interval '200 days' WHERE pouch_id = $1`,
			[pouchId],
		);
		await expireRevisions(h.deps);
		await h.owner.query(
			`UPDATE blobs SET unreferenced_since = now() - interval '2 days' WHERE ref_count = 0`,
		);
		await gcBlobs(h.deps);
		await purgeEvents(h.deps);

		expect(await revisionIds(item.id)).toEqual([item.tombstone]);
		// A computer whose cursor predates the purged events still finds it.
		expectTombstone(await listed(item.id), before, item.tombstone);
		expect(await blobStatus(item.blobs[0]!)).toBe(404);
	});

	it('the database refuses to drop an item or its head outside a pouch purge', async () => {
		const item = await deletedItem();
		await expect(
			h.owner.query('DELETE FROM artifacts WHERE id = $1', [item.id]),
		).rejects.toThrow(/kept until their pouch is purged/);
		await expect(
			h.owner.query('UPDATE artifacts SET head_revision_id = NULL WHERE id = $1', [item.id]),
		).rejects.toThrow(/kept until their pouch is purged/);
		await expect(
			h.owner.query('DELETE FROM revisions WHERE id = $1', [item.tombstone]),
		).rejects.toThrow(/foreign key/);
		expect(await revisionIds(item.id)).toContain(item.tombstone);
	});

	it('a freed item can still come back, with new files', async () => {
		const item = await deletedItem();
		await alice.browser.post(`/v1/pouches/${pouchId}/free-space`, { artifact_ids: [item.id] });
		const [fresh] = await uploadBlobs(cli, pouchId);
		const restored = await commitOne(device, pouchId, epoch, {
			type: 'restore',
			artifactId: item.id,
			baseRevisionId: item.tombstone,
			nameIndex: nameIndex(),
			blobIds: [fresh!.id],
		});
		expect(restored.status).toBe('applied');
		const after = await listed(item.id);
		expect(after?.deleted_at).toBeNull();
		expect(after?.head?.parent_id).toBe(item.tombstone);
	});
});
