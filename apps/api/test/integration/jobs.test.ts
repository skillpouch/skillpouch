// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Background jobs against real data: retention, blob GC,
 * quota bookkeeping, integrity sampling, expiries and the delayed purges
 * (pouch delete, encrypted-data reset, account delete). Time is moved by
 * back-dating rows, so every job runs exactly as it would in production.
 */
import { readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PgBoss } from 'pg-boss';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { uuidv7 } from '../../src/lib/ids';
import { JOBS } from '../../src/jobs/registry';
import { gcBlobs, gcPending } from '../../src/jobs/gc';
import {
	expireBrowserTrust,
	expireCliAuthRequests,
	purgeEphemeral,
	recalcUsage,
	refreshAllEntitlements,
	verifyBlobSample,
} from '../../src/jobs/housekeeping';
import {
	purgeDeletedAccounts,
	purgeDeletedPouches,
	resetEncryptedAccounts,
} from '../../src/jobs/purge';
import { expireRevisions, purgeEvents, purgeReceipts } from '../../src/jobs/retention';
import { runJob, startScheduler } from '../../src/worker';
import type { CliClient } from '../helpers/clients';
import { randomBlobId } from '../helpers/e2ee';
import { authorizeCli, setupAccount, type Account } from '../helpers/flows';
import { createHarness, type Harness } from '../helpers/harness';
import { commitOne, nameIndex, pouchState, uploadBlobs, type Writer } from '../helpers/sync';

function filesUnder(dir: string): string[] {
	try {
		return readdirSync(dir).flatMap((name) => {
			const path = join(dir, name);
			return statSync(path).isDirectory() ? filesUnder(path) : [path];
		});
	} catch {
		return [];
	}
}

describe('background jobs', () => {
	let h: Harness;
	let alice: Account;
	let cli: CliClient;
	let writer: Writer;
	let epoch: string;

	const one = async <T = Record<string, unknown>>(query: string, params: unknown[] = []) =>
		(await h.owner.query(query, params)).rows[0] as T;

	beforeAll(async () => {
		h = await createHarness();
		alice = await setupAccount(h, 'alice@skillpouch.test');
		cli = await authorizeCli(h, alice);
		writer = { client: cli, memberId: cli.memberId, key: cli.key };
		epoch = (await pouchState(cli, alice.pouchId)).epoch;
	});
	afterAll(async () => {
		await h.close();
	});

	it('every job has a unique name and a cron schedule', () => {
		expect(new Set(JOBS.map((job) => job.name)).size).toBe(JOBS.length);
		for (const job of JOBS) expect(job.cron.split(' ')).toHaveLength(5);
	});

	describe('retention and garbage collection', () => {
		it('expires old revisions, releases their blobs and frees quota', async () => {
			const artifactId = uuidv7();
			const [blob] = await uploadBlobs(cli, alice.pouchId);
			const created = await commitOne(writer, alice.pouchId, epoch, {
				type: 'create',
				artifactId,
				baseRevisionId: null,
				nameIndex: nameIndex(),
				blobIds: [blob!.id],
			});
			await commitOne(writer, alice.pouchId, epoch, {
				type: 'update',
				artifactId,
				baseRevisionId: created.revision_id,
			});
			const before = await one<{ used_bytes: string }>(
				'SELECT used_bytes FROM storage_accounts WHERE id = $1',
				[alice.accountId],
			);

			// Not yet due: nothing happens.
			expect(await expireRevisions(h.deps)).toBe(0);
			await h.owner.query(
				`UPDATE revisions SET expires_at = now() - interval '1 minute' WHERE id = $1`,
				[created.revision_id],
			);
			expect(await expireRevisions(h.deps)).toBe(1);
			expect(
				await one('SELECT count(*)::int AS n FROM revisions WHERE id = $1', [
					created.revision_id,
				]),
			).toEqual({ n: 0 });
			const blobRow = await one<{ ref_count: number; unreferenced_since: Date | null }>(
				`SELECT ref_count, unreferenced_since FROM blobs WHERE blob_id = decode($1, 'base64')`,
				[Buffer.from(blob!.id, 'base64url').toString('base64')],
			);
			expect(blobRow.ref_count).toBe(0);
			expect(blobRow.unreferenced_since).not.toBeNull();
			const after = await one<{ used_bytes: string }>(
				'SELECT used_bytes FROM storage_accounts WHERE id = $1',
				[alice.accountId],
			);
			expect(Number(after.used_bytes)).toBeLessThan(Number(before.used_bytes));

			// The blob survives the 24 h grace period, then GC deletes row and file.
			const filesBefore = filesUnder(h.blobRoot).length;
			expect(await gcBlobs(h.deps)).toBe(0);
			await h.owner.query(
				`UPDATE blobs SET unreferenced_since = now() - interval '25 hours' WHERE ref_count = 0`,
			);
			const removed = await gcBlobs(h.deps);
			expect(removed).toBeGreaterThanOrEqual(1);
			expect(filesUnder(h.blobRoot).length).toBe(filesBefore - removed);
		});

		it('never collects a blob that a revision still references', async () => {
			const [blob] = await uploadBlobs(cli, alice.pouchId);
			await commitOne(writer, alice.pouchId, epoch, {
				type: 'create',
				artifactId: uuidv7(),
				baseRevisionId: null,
				nameIndex: nameIndex(),
				blobIds: [blob!.id],
			});
			// Even a wrong counter cannot make GC delete a referenced blob.
			await h.owner.query(
				`UPDATE blobs SET ref_count = 0, unreferenced_since = now() - interval '2 days'`,
			);
			await gcBlobs(h.deps);
			const download = await cli.get(`/v1/pouches/${alice.pouchId}/blobs/${blob!.id}`);
			expect(download.status).toBe(200);
			await recalcUsage(h.deps);
			await h.owner.query(
				`UPDATE blobs b SET ref_count = (SELECT count(*) FROM revision_blobs rb WHERE rb.blob_id = b.blob_id), unreferenced_since = NULL`,
			);
		});

		it('releases stale quota reservations', async () => {
			await cli.post(`/v1/pouches/${alice.pouchId}/blobs/check`, {
				blobs: [{ id: randomBlobId(), stored_size: 4096 }],
			});
			const reserved = await one<{ pending_bytes: string }>(
				'SELECT pending_bytes FROM storage_accounts WHERE id = $1',
				[alice.accountId],
			);
			expect(Number(reserved.pending_bytes)).toBeGreaterThanOrEqual(4096);
			await h.owner.query(
				`UPDATE blobs SET created_at = now() - interval '2 hours' WHERE state = 'pending'`,
			);
			expect(await gcPending(h.deps)).toBe(1);
			expect(
				await one('SELECT pending_bytes::int AS n FROM storage_accounts WHERE id = $1', [
					alice.accountId,
				]),
			).toEqual({ n: 0 });
		});

		it('purges 90-day-old events and tells stale cursors to rebase', async () => {
			const { event_seq } = await pouchState(cli, alice.pouchId);
			await h.owner.query(
				`UPDATE events SET created_at = now() - interval '91 days' WHERE pouch_id = $1 AND seq <= 2`,
				[alice.pouchId],
			);
			expect(await purgeEvents(h.deps)).toBe(2);
			const stale = await cli.get(
				`/v1/pouches/${alice.pouchId}/events?after=0&epoch=${epoch}`,
			);
			expect(stale.body.error).toMatchObject({
				code: 'cursor_expired',
				details: { oldest_seq: 3 },
			});
			const fresh = await cli.get(
				`/v1/pouches/${alice.pouchId}/events?after=2&epoch=${epoch}`,
			);
			expect(fresh.body.data.events).toHaveLength(event_seq - 2);
		});

		it('purges receipts older than 30 days', async () => {
			await h.owner.query(
				`UPDATE operation_receipts SET created_at = now() - interval '31 days'`,
			);
			expect(await purgeReceipts(h.deps)).toBeGreaterThan(0);
		});
	});

	describe('bookkeeping and integrity', () => {
		it('corrects usage drift', async () => {
			const truth = await one<{ used_bytes: string }>(
				'SELECT used_bytes FROM storage_accounts WHERE id = $1',
				[alice.accountId],
			);
			await h.owner.query('UPDATE storage_accounts SET used_bytes = 1 WHERE id = $1', [
				alice.accountId,
			]);
			expect(await recalcUsage(h.deps)).toBeGreaterThanOrEqual(1);
			const fixed = await one<{ used_bytes: string }>(
				'SELECT used_bytes FROM storage_accounts WHERE id = $1',
				[alice.accountId],
			);
			expect(fixed.used_bytes).toBe(truth.used_bytes);
		});

		it('detects a corrupted blob on disk', async () => {
			const files = filesUnder(h.blobRoot).filter((path) => !path.includes('.tmp'));
			expect((await verifyBlobSample(h.deps, 1)).bad).toBe(0);
			writeFileSync(files[0]!, Buffer.from('bit rot'));
			const result = await verifyBlobSample(h.deps, 1);
			expect(result.bad).toBe(1);
			expect(
				await one(
					`SELECT count(*)::int AS n FROM security_events WHERE kind = 'blob.corrupt'`,
				),
			).toEqual({ n: 1 });
		});
	});

	describe('expiries', () => {
		it('expires abandoned CLI login requests', async () => {
			await h.owner.query(
				`UPDATE cli_auth_requests SET state = 'open', expires_at = now() - interval '1 minute' WHERE state = 'redeemed'`,
			);
			const { expired } = await expireCliAuthRequests(h.deps);
			expect(expired).toBeGreaterThanOrEqual(1);
		});

		it('marks browsers unused for longer than the trust window', async () => {
			await h.owner.query(
				`UPDATE account_members SET last_seen_at = now() - interval '40 days' WHERE id = $1`,
				[alice.browserMember.id],
			);
			expect(await expireBrowserTrust(h.deps)).toBe(1);
			expect((await alice.browser.get('/v1/account/key-envelopes')).body.error.code).toBe(
				'browser_trust_expired',
			);
			await h.owner.query(
				`UPDATE account_members SET last_seen_at = now(), trust_expired_at = NULL WHERE id = $1`,
				[alice.browserMember.id],
			);
		});

		it('purges expired short-lived rows', async () => {
			await h.owner.query(`UPDATE dpop_replay SET expires_at = now() - interval '1 minute'`);
			expect(await purgeEphemeral(h.deps)).toBeGreaterThan(0);
		});

		it('refreshes every account’s entitlements', async () => {
			expect(await refreshAllEntitlements(h.deps)).toBeGreaterThanOrEqual(1);
		});
	});

	describe('delayed purges', () => {
		it('purges a deleted pouch after its undo window, files included', async () => {
			const bob = await setupAccount(h, 'bob@skillpouch.test');
			const bobCli = await authorizeCli(h, bob);
			const bobEpoch = (await pouchState(bobCli, bob.pouchId)).epoch;
			const [blob] = await uploadBlobs(bobCli, bob.pouchId);
			await commitOne(
				{ client: bobCli, memberId: bobCli.memberId, key: bobCli.key },
				bob.pouchId,
				bobEpoch,
				{
					type: 'create',
					artifactId: uuidv7(),
					baseRevisionId: null,
					nameIndex: nameIndex(),
					blobIds: [blob!.id],
				},
			);
			expect((await bob.browser.delete(`/v1/pouches/${bob.pouchId}`)).status).toBe(200);
			expect(await purgeDeletedPouches(h.deps)).toBe(0);
			await h.owner.query(
				`UPDATE pouches SET delete_after = now() - interval '1 minute' WHERE id = $1`,
				[bob.pouchId],
			);
			expect(await purgeDeletedPouches(h.deps)).toBe(1);
			expect(
				await one('SELECT count(*)::int AS n FROM artifacts WHERE pouch_id = $1', [
					bob.pouchId,
				]),
			).toEqual({ n: 0 });
			expect(filesUnder(join(h.blobRoot, bob.accountId, bob.pouchId))).toEqual([]);
			expect(
				await one('SELECT used_bytes::int AS n FROM storage_accounts WHERE id = $1', [
					bob.accountId,
				]),
			).toEqual({ n: 0 });
			// Alice is untouched.
			expect(
				(await cli.get(`/v1/pouches/${alice.pouchId}/artifacts`)).body.data.items.length,
			).toBeGreaterThan(0);
		});

		it('performs a confirmed "lost everything" reset: roster, members and data gone, CLIs revoked', async () => {
			const carol = await setupAccount(h, 'carol@skillpouch.test');
			const carolCli = await authorizeCli(h, carol);
			expect(
				(
					await carol.browser.post('/v1/account/reset-encryption', {
						confirm: 'RESET MY ENCRYPTED DATA',
					})
				).status,
			).toBe(200);
			await h.owner.query(
				`UPDATE storage_accounts SET reset_after = now() - interval '1 minute' WHERE id = $1`,
				[carol.accountId],
			);
			expect(await resetEncryptedAccounts(h.deps)).toBe(1);
			const me = await carol.browser.get('/v1/me');
			expect(me.body.data.account.roster_initialized).toBe(false);
			expect((await carolCli.get('/v1/pouches')).body.error.code).toBe('device_revoked');
			expect(
				await one(
					'SELECT count(*)::int AS n FROM account_members WHERE storage_account_id = $1',
					[carol.accountId],
				),
			).toEqual({ n: 0 });
			// The user can start over with a new genesis.
			expect((await carol.browser.get('/v1/account/unlock/params')).body.data.state).toBe(
				'setup_required',
			);
		});

		it('purges a deleted account completely after 7 days', async () => {
			const dave = await setupAccount(h, 'dave@skillpouch.test');
			await authorizeCli(h, dave);
			expect((await dave.browser.delete('/v1/account')).status).toBe(200);
			await h.owner.query(
				`UPDATE storage_accounts SET delete_after = now() - interval '1 minute' WHERE id = $1`,
				[dave.accountId],
			);
			expect(await purgeDeletedAccounts(h.deps)).toBe(1);
			expect(
				await one('SELECT count(*)::int AS n FROM users WHERE id = $1', [
					dave.browser.userId,
				]),
			).toEqual({ n: 0 });
			expect(
				await one('SELECT count(*)::int AS n FROM storage_accounts WHERE id = $1', [
					dave.accountId,
				]),
			).toEqual({ n: 0 });
		});
	});

	describe('worker', () => {
		it('registers every job with pg-boss as a schedule and runs them', async () => {
			const boss = new PgBoss({ connectionString: h.database.url });
			await boss.start();
			try {
				await startScheduler(h.deps, boss);
				const schedules = await boss.getSchedules();
				expect(schedules.map((s) => s.name).sort()).toEqual(
					JOBS.map((job) => job.name).sort(),
				);
			} finally {
				await boss.stop({ graceful: false });
			}
			for (const job of JOBS) await runJob(h.deps, job);
		});
	});
});
