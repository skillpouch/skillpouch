// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The sync protocol through the HTTP API: encrypted blobs, signed
 * commits with optimistic concurrency, conflicts that never lose data, the
 * event feed (pull + long-poll), snapshots, artifact browsing, bindings and
 * checkpoints — plus tenant isolation on every one of those routes.
 */
import { randomBytes } from 'node:crypto';
import { blake3 } from '@noble/hashes/blake3.js';
import { toBase64Url } from '@skillpouch/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { uuidv7 } from '../../src/lib/ids';
import type { CliClient } from '../helpers/clients';
import { b64, randomBlobId, rosterHead, sealed } from '../helpers/e2ee';
import { authorizeCli, setupAccount, type Account } from '../helpers/flows';
import { createHarness, type Harness } from '../helpers/harness';
import { TestKey } from '../helpers/keys';
import {
	buildOp,
	commit,
	commitOne,
	nameIndex,
	pouchState,
	uploadBlobs,
	type Writer,
} from '../helpers/sync';

describe('sync protocol', () => {
	let h: Harness;
	let alice: Account;
	let bob: Account;
	let cli: CliClient;
	let web: Writer;
	let device: Writer;
	let epoch: string;

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
		epoch = (await pouchState(alice.browser, alice.pouchId)).epoch;
	});
	afterAll(async () => {
		await h.close();
	});

	describe('blobs', () => {
		it('reports missing blobs, stores uploads and serves them back byte-for-byte', async () => {
			const [blob] = await uploadBlobs(cli, alice.pouchId);
			const check = await cli.post(`/v1/pouches/${alice.pouchId}/blobs/check`, {
				blobs: [{ id: blob!.id, stored_size: blob!.bytes.length }],
			});
			expect(check.body.data.missing).toEqual([]);
			const download = await alice.browser.get(
				`/v1/pouches/${alice.pouchId}/blobs/${blob!.id}`,
			);
			expect(download.status).toBe(200);
			expect(Buffer.compare(download.raw.rawPayload, blob!.bytes)).toBe(0);
			expect(download.headers.etag).toBe(`"${toBase64Url(blake3(blob!.bytes))}"`);
		});

		it('rejects a body whose BLAKE3 does not match the header', async () => {
			const bytes = sealed(1);
			const response = await cli.request(
				'PUT',
				`/v1/pouches/${alice.pouchId}/blobs/${randomBlobId()}`,
				{
					rawBody: bytes,
					headers: { 'skillpouch-ciphertext-hash': b64(randomBytes(32)) },
				},
			);
			expect(response.body.error.code).toBe('ciphertext_hash_mismatch');
		});

		it('rejects plaintext (no sealed header)', async () => {
			const bytes = Buffer.from('# SKILL.md in plaintext — must never be accepted');
			const response = await cli.request(
				'PUT',
				`/v1/pouches/${alice.pouchId}/blobs/${randomBlobId()}`,
				{
					rawBody: bytes,
					headers: { 'skillpouch-ciphertext-hash': toBase64Url(blake3(bytes)) },
				},
			);
			expect(response.body.error.code).toBe('envelope_invalid');
		});

		it('uploads and fetches many blobs in one framed request', async () => {
			const items = [sealed(1, 10), sealed(1, 20), sealed(1, 30)].map((bytes) => ({
				id: randomBytes(32),
				bytes,
			}));
			const frames = Buffer.concat(
				items.flatMap((item) => {
					const length = Buffer.alloc(4);
					length.writeUInt32BE(item.bytes.length);
					return [item.id, Buffer.from(blake3(item.bytes)), length, item.bytes];
				}),
			);
			const upload = await cli.request('POST', `/v1/pouches/${alice.pouchId}/blobs/batch`, {
				rawBody: frames,
			});
			expect(upload.status).toBe(200);
			expect(upload.body.data.stored).toHaveLength(3);

			const fetched = await alice.browser.post(`/v1/pouches/${alice.pouchId}/blobs/fetch`, {
				ids: items.map((item) => b64(item.id)),
			});
			expect(fetched.status).toBe(200);
			const body = fetched.raw.rawPayload;
			let offset = 0;
			for (const item of items) {
				expect(body.subarray(offset, offset + 32).equals(item.id)).toBe(true);
				const length = body.readUInt32BE(offset + 32);
				expect(body.subarray(offset + 36, offset + 36 + length).equals(item.bytes)).toBe(
					true,
				);
				offset += 36 + length;
			}
		});

		it('rejects uploads beyond the storage quota before any byte is stored', async () => {
			const response = await cli.post(`/v1/pouches/${alice.pouchId}/blobs/check`, {
				blobs: Array.from({ length: 200 }, () => ({
					id: randomBlobId(),
					stored_size: 1024 * 1024,
				})),
			});
			expect(response.status).toBe(413);
			expect(response.body.error.code).toBe('quota_exceeded');
		});

		it("never serves another account's blob (404, not 403)", async () => {
			const [blob] = await uploadBlobs(cli, alice.pouchId);
			expect(
				(await bob.browser.get(`/v1/pouches/${alice.pouchId}/blobs/${blob!.id}`)).status,
			).toBe(404);
			expect(
				(await bob.browser.get(`/v1/pouches/${bob.pouchId}/blobs/${blob!.id}`)).status,
			).toBe(404);
		});
	});

	describe('commits', () => {
		it('creates an artifact from the CLI (signed request) and from the web', async () => {
			const blobs = await uploadBlobs(cli, alice.pouchId, 2);
			const fromCli = await commitOne(device, alice.pouchId, epoch, {
				type: 'create',
				artifactId: uuidv7(),
				baseRevisionId: null,
				nameIndex: nameIndex(),
				blobIds: blobs.map((blob) => blob.id),
			});
			expect(fromCli.status).toBe('applied');
			const fromWeb = await commitOne(web, alice.pouchId, epoch, {
				type: 'create',
				artifactId: uuidv7(),
				baseRevisionId: null,
				nameIndex: nameIndex(),
			});
			expect(fromWeb.status).toBe('applied');
			expect(fromWeb.seq).toBe(fromCli.seq + 1);
		});

		it('requires the detached device signature from CLI devices', async () => {
			const op = await buildOp(device, alice.pouchId, {
				type: 'create',
				artifactId: uuidv7(),
				baseRevisionId: null,
				nameIndex: nameIndex(),
			});
			const response = await commit(device, alice.pouchId, epoch, [op], {
				noSignature: true,
			});
			expect(response.body.error.code).toBe('signature_invalid');
		});

		it('rejects a revision signed by a key that is not the member key', async () => {
			const result = await commitOne(device, alice.pouchId, epoch, {
				type: 'create',
				artifactId: uuidv7(),
				baseRevisionId: null,
				nameIndex: nameIndex(),
				signWith: await TestKey.generate(),
			});
			expect(result).toMatchObject({ status: 'rejected', code: 'signature_invalid' });
		});

		it('rejects operations claiming another member as signer', async () => {
			const op = await buildOp(
				{ ...device, memberId: alice.browserMember.id },
				alice.pouchId,
				{
					type: 'create',
					artifactId: uuidv7(),
					baseRevisionId: null,
					nameIndex: nameIndex(),
				},
			);
			const response = await commit(device, alice.pouchId, epoch, [op]);
			expect(response.body.data.results[0]).toMatchObject({
				status: 'rejected',
				code: 'member_inactive',
			});
		});

		it('rejects wrong key generations, missing blobs and missing name index', async () => {
			const results = await Promise.all([
				commitOne(device, alice.pouchId, epoch, {
					type: 'create',
					artifactId: uuidv7(),
					baseRevisionId: null,
					nameIndex: nameIndex(),
					keyGen: 2,
				}),
				commitOne(device, alice.pouchId, epoch, {
					type: 'create',
					artifactId: uuidv7(),
					baseRevisionId: null,
					nameIndex: nameIndex(),
					blobIds: [randomBlobId()],
				}),
				commitOne(device, alice.pouchId, epoch, {
					type: 'create',
					artifactId: uuidv7(),
					baseRevisionId: null,
				}),
			]);
			expect(results.map((result) => result.code)).toEqual([
				'key_gen_invalid',
				'blob_missing',
				'validation_failed',
			]);
		});

		it('is idempotent per operation_id and refuses a reused id with a different body', async () => {
			const operationId = uuidv7();
			const op = await buildOp(device, alice.pouchId, {
				type: 'create',
				artifactId: uuidv7(),
				baseRevisionId: null,
				nameIndex: nameIndex(),
			});
			const first = await commit(device, alice.pouchId, epoch, [op], { operationId });
			const again = await commit(device, alice.pouchId, epoch, [op], { operationId });
			expect(again.body.data).toEqual(first.body.data);
			const other = await buildOp(device, alice.pouchId, {
				type: 'create',
				artifactId: uuidv7(),
				baseRevisionId: null,
				nameIndex: nameIndex(),
			});
			const reused = await commit(device, alice.pouchId, epoch, [other], { operationId });
			expect(reused.body.error.code).toBe('operation_id_reused');
		});

		it('refuses a stale epoch', async () => {
			const op = await buildOp(device, alice.pouchId, {
				type: 'create',
				artifactId: uuidv7(),
				baseRevisionId: null,
				nameIndex: nameIndex(),
			});
			const response = await commit(device, alice.pouchId, uuidv7(), [op]);
			expect(response.body.error).toMatchObject({
				code: 'epoch_mismatch',
				details: { epoch },
			});
		});

		it("cannot write into another account's pouch", async () => {
			const op = await buildOp(device, bob.pouchId, {
				type: 'create',
				artifactId: uuidv7(),
				baseRevisionId: null,
				nameIndex: nameIndex(),
			});
			const bobEpoch = (await pouchState(bob.browser, bob.pouchId)).epoch;
			const response = await commit(device, bob.pouchId, bobEpoch, [op]);
			expect(response.status).toBe(404);
		});
	});

	describe('conflicts never lose data', () => {
		it('turns a stale update into update_update and resolves it with a merge', async () => {
			const artifactId = uuidv7();
			const created = await commitOne(device, alice.pouchId, epoch, {
				type: 'create',
				artifactId,
				baseRevisionId: null,
				nameIndex: nameIndex(),
			});
			const webEdit = await commitOne(web, alice.pouchId, epoch, {
				type: 'update',
				artifactId,
				baseRevisionId: created.revision_id,
			});
			expect(webEdit.status).toBe('applied');
			const cliEdit = await commitOne(device, alice.pouchId, epoch, {
				type: 'update',
				artifactId,
				baseRevisionId: created.revision_id,
			});
			expect(cliEdit).toMatchObject({
				status: 'conflict',
				conflict_type: 'update_update',
				server_revision_id: webEdit.revision_id,
			});

			// Both revisions are kept; the head is still the web edit.
			const history = await alice.browser.get(
				`/v1/pouches/${alice.pouchId}/artifacts/${artifactId}/revisions`,
			);
			expect(history.body.data.items.map((revision: { id: string }) => revision.id)).toEqual(
				expect.arrayContaining([
					created.revision_id,
					webEdit.revision_id,
					cliEdit.revision_id,
				]),
			);
			const open = await alice.browser.get(
				`/v1/pouches/${alice.pouchId}/conflicts?state=open`,
			);
			expect(
				open.body.data.conflicts.some((c: { id: string }) => c.id === cliEdit.conflict_id),
			).toBe(true);

			const resolved = await commitOne(device, alice.pouchId, epoch, {
				type: 'resolve',
				artifactId,
				baseRevisionId: webEdit.revision_id,
				mergeParentId: cliEdit.revision_id,
				conflictId: cliEdit.conflict_id,
			});
			expect(resolved.status).toBe('applied');
			const conflict = await alice.browser.get(
				`/v1/pouches/${alice.pouchId}/conflicts/${cliEdit.conflict_id}`,
			);
			expect(conflict.body.data).toMatchObject({ state: 'resolved', resolution: 'merged' });
		});

		it('records edit_delete when a device edits a deleted artifact, then restores', async () => {
			const artifactId = uuidv7();
			const name = nameIndex();
			const created = await commitOne(device, alice.pouchId, epoch, {
				type: 'create',
				artifactId,
				baseRevisionId: null,
				nameIndex: name,
			});
			const deleted = await commitOne(web, alice.pouchId, epoch, {
				type: 'delete',
				artifactId,
				baseRevisionId: created.revision_id,
			});
			expect(deleted.status).toBe('applied');
			const edit = await commitOne(device, alice.pouchId, epoch, {
				type: 'update',
				artifactId,
				baseRevisionId: deleted.revision_id,
			});
			expect(edit).toMatchObject({ status: 'conflict', conflict_type: 'edit_delete' });
			const restored = await commitOne(web, alice.pouchId, epoch, {
				type: 'restore',
				artifactId,
				baseRevisionId: deleted.revision_id,
				nameIndex: name,
			});
			expect(restored.status).toBe('applied');
		});

		it('reports a blind-name collision instead of creating a duplicate', async () => {
			const name = nameIndex();
			await commitOne(device, alice.pouchId, epoch, {
				type: 'create',
				artifactId: uuidv7(),
				baseRevisionId: null,
				nameIndex: name,
			});
			const twin = await commitOne(web, alice.pouchId, epoch, {
				type: 'create',
				artifactId: uuidv7(),
				baseRevisionId: null,
				nameIndex: name,
			});
			expect(twin).toMatchObject({ status: 'conflict', conflict_type: 'name_collision' });
			const live = await alice.browser.get(
				`/v1/pouches/${alice.pouchId}/artifacts?limit=200`,
			);
			expect(
				live.body.data.items.filter((a: { name_index: string }) => a.name_index === name),
			).toHaveLength(1);
		});

		it('serializes concurrent commits on one artifact: one applies, one conflicts', async () => {
			const artifactId = uuidv7();
			const created = await commitOne(device, alice.pouchId, epoch, {
				type: 'create',
				artifactId,
				baseRevisionId: null,
				nameIndex: nameIndex(),
			});
			const [a, b] = await Promise.all([
				commitOne(device, alice.pouchId, epoch, {
					type: 'update',
					artifactId,
					baseRevisionId: created.revision_id,
				}),
				commitOne(web, alice.pouchId, epoch, {
					type: 'update',
					artifactId,
					baseRevisionId: created.revision_id,
				}),
			]);
			expect([a.status, b.status].sort()).toEqual(['applied', 'conflict']);
		});
	});

	describe('event feed', () => {
		it('returns dense, ordered events after a cursor', async () => {
			const state = await pouchState(alice.browser, alice.pouchId);
			const page = await cli.get(
				`/v1/pouches/${alice.pouchId}/events?after=0&epoch=${epoch}`,
			);
			const seqs = page.body.data.events.map((event: { seq: number }) => event.seq);
			expect(seqs).toEqual(Array.from({ length: seqs.length }, (_, index) => index + 1));
			expect(page.body.data.high_water).toBe(state.event_seq);
			expect(page.body.data.next_cursor).toBe(seqs.at(-1));
		});

		it('long-polls until a commit lands', async () => {
			const { event_seq } = await pouchState(alice.browser, alice.pouchId);
			const started = Date.now();
			const poll = cli.get(
				`/v1/pouches/${alice.pouchId}/events?after=${event_seq}&epoch=${epoch}&wait=10`,
			);
			await new Promise((resolve) => setTimeout(resolve, 300));
			await commitOne(web, alice.pouchId, epoch, {
				type: 'create',
				artifactId: uuidv7(),
				baseRevisionId: null,
				nameIndex: nameIndex(),
			});
			const response = await poll;
			expect(response.body.data.events).toHaveLength(1);
			expect(response.body.data.events[0].type).toBe('artifact.created');
			expect(Date.now() - started).toBeLessThan(8000);
		});

		it('tells a client with a stale epoch to rebase', async () => {
			const response = await cli.get(
				`/v1/pouches/${alice.pouchId}/events?after=0&epoch=${uuidv7()}`,
			);
			expect(response.body.error.code).toBe('epoch_mismatch');
		});

		it("hides another account's pouch", async () => {
			const response = await bob.browser.get(
				`/v1/pouches/${alice.pouchId}/events?after=0&epoch=${epoch}`,
			);
			expect(response.status).toBe(404);
		});
	});

	describe('snapshots and browsing', () => {
		it('bootstraps from a snapshot that contains every head', async () => {
			const created = await cli.post(`/v1/pouches/${alice.pouchId}/snapshots`);
			expect(created.body.data.epoch).toBe(epoch);
			const page = await cli.get(
				`/v1/pouches/${alice.pouchId}/snapshots/${created.body.data.snapshot_id}`,
			);
			expect(page.status).toBe(200);
			const all = await alice.browser.get(
				`/v1/pouches/${alice.pouchId}/artifacts?limit=200&include_deleted=true`,
			);
			expect(page.body.data.items.length).toBe(all.body.data.items.length);
			for (const item of page.body.data.items) expect(item.head.envelope).toBeTruthy();
		});

		it('paginates artifacts with an opaque cursor', async () => {
			const first = await alice.browser.get(`/v1/pouches/${alice.pouchId}/artifacts?limit=2`);
			expect(first.body.data.items).toHaveLength(2);
			expect(first.body.meta.next_cursor).toBeTruthy();
			const second = await alice.browser.get(
				`/v1/pouches/${alice.pouchId}/artifacts?limit=2&cursor=${first.body.meta.next_cursor}`,
			);
			expect(second.body.data.items[0].id > first.body.data.items[1].id).toBe(true);
		});

		it('batch-fetches revisions but only from this pouch', async () => {
			const list = await alice.browser.get(`/v1/pouches/${alice.pouchId}/artifacts?limit=3`);
			const ids = list.body.data.items.map(
				(artifact: { head: { id: string } }) => artifact.head.id,
			);
			const fetched = await cli.get(
				`/v1/pouches/${alice.pouchId}/revisions?ids=${ids.join(',')}`,
			);
			expect(fetched.body.data.revisions).toHaveLength(ids.length);
			const foreign = await bob.browser.get(
				`/v1/pouches/${bob.pouchId}/revisions?ids=${ids.join(',')}`,
			);
			expect(foreign.body.data.revisions).toHaveLength(0);
		});
	});

	describe('bindings and checkpoints', () => {
		it('stores encrypted bindings per device and emits binding.changed', async () => {
			const artifactId = uuidv7();
			await commitOne(device, alice.pouchId, epoch, {
				type: 'create',
				artifactId,
				baseRevisionId: null,
				nameIndex: nameIndex(),
			});
			const put = await cli.put(`/v1/pouches/${alice.pouchId}/bindings`, {
				bindings: [{ artifact_id: artifactId, payload: b64(sealed(1, 40)), key_gen: 1 }],
			});
			expect(put.status).toBe(200);
			const list = await alice.browser.get(`/v1/pouches/${alice.pouchId}/bindings`);
			expect(list.body.data.bindings).toEqual([
				expect.objectContaining({ artifact_id: artifactId, device_id: cli.deviceId }),
			]);
			const removed = await cli.put(`/v1/pouches/${alice.pouchId}/bindings`, {
				bindings: [{ artifact_id: artifactId, payload: null, key_gen: 1 }],
			});
			expect(removed.status).toBe(200);
			expect(
				(await alice.browser.get(`/v1/pouches/${alice.pouchId}/bindings`)).body.data
					.bindings,
			).toHaveLength(0);
		});

		it('browsers cannot write device bindings (device-only route)', async () => {
			const response = await alice.browser.put(`/v1/pouches/${alice.pouchId}/bindings`, {
				bindings: [{ artifact_id: uuidv7(), payload: null, key_gen: 1 }],
			});
			expect(response.status).toBe(401);
		});

		it('accepts only a correctly signed checkpoint for the caller', async () => {
			const head = await rosterHead(alice.browser);
			const { event_seq } = await pouchState(alice.browser, alice.pouchId);
			const seq = Buffer.alloc(8);
			seq.writeBigUInt64BE(BigInt(event_seq));
			const message = Buffer.concat([
				Buffer.from(alice.pouchId),
				seq,
				Buffer.from(head.hash!, 'base64url'),
			]);
			const body = {
				member_id: cli.memberId,
				pouch_seq: event_seq,
				roster_head: head.hash!,
				signature: await cli.key.sign('skillpouch/v1/checkpoint', message),
			};
			expect(
				(await cli.put(`/v1/pouches/${alice.pouchId}/checkpoints/me`, body)).status,
			).toBe(200);
			const forged = {
				...body,
				signature: await alice.browserMember.key.sign('skillpouch/v1/checkpoint', message),
			};
			expect(
				(await cli.put(`/v1/pouches/${alice.pouchId}/checkpoints/me`, forged)).body.error
					.code,
			).toBe('signature_invalid');
			const list = await alice.browser.get(`/v1/pouches/${alice.pouchId}/checkpoints`);
			expect(list.body.data.checkpoints).toEqual([
				expect.objectContaining({ member_id: cli.memberId, pouch_seq: event_seq }),
			]);
		});
	});
});
