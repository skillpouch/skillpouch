// SPDX-License-Identifier: AGPL-3.0-only
/**
 * End to end over a real HTTP socket: the full user journey the web app and
 * the CLI drive, in order —
 *
 *   web onboarding (master password params, genesis) → "Authorize CLI" →
 *   CLI uploads + commits → the browser sees it live on the SSE stream →
 *   a second CLI conflicts and resolves → a new browser unlocks with the
 *   master password and becomes trusted → the CLI is revoked from the web
 *   and its stream ends → graceful shutdown tells streams to reconnect.
 *
 * Plus the operational surface: health, readiness, Swagger in dev, the
 * response envelope, request ids, security headers and CORS.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { uuidv7 } from '../../src/lib/ids';
import { openStreams } from '../../src/modules/events/event-stream';
import { signIn, type BaseClient, type CliClient } from '../helpers/clients';
import { keyEnvelope, memberJson, newMember, rosterHead, statement } from '../helpers/e2ee';
import { authorizeCli, setupAccount, type Account } from '../helpers/flows';
import { createHarness, WEB_ORIGIN, type Harness } from '../helpers/harness';
import { commitOne, nameIndex, pouchState, uploadBlobs, type Writer } from '../helpers/sync';

interface SseFrame {
	event: string;
	data: Record<string, unknown>;
	id?: string;
}

/** A live Server-Sent Events connection with a frame queue. */
class SseConnection {
	readonly frames: SseFrame[] = [];
	private readonly controller = new AbortController();
	private waiters: (() => void)[] = [];
	ended = false;

	static async open(harness: Harness, client: BaseClient): Promise<SseConnection> {
		const connection = new SseConnection();
		const headers = await client.signedHeaders('GET', '/v1/events/stream');
		const response = await fetch(`${harness.baseUrl}/v1/events/stream`, {
			headers,
			signal: connection.controller.signal,
		});
		expect(response.status).toBe(200);
		expect(response.headers.get('content-type')).toContain('text/event-stream');
		void connection.pump(response.body!);
		return connection;
	}

	private async pump(body: ReadableStream<Uint8Array>) {
		const decoder = new TextDecoder();
		let buffer = '';
		try {
			for await (const chunk of body as unknown as AsyncIterable<Uint8Array>) {
				buffer += decoder.decode(chunk, { stream: true });
				let index;
				while ((index = buffer.indexOf('\n\n')) >= 0) {
					const raw = buffer.slice(0, index);
					buffer = buffer.slice(index + 2);
					const frame: Partial<SseFrame> = {};
					for (const line of raw.split('\n')) {
						if (line.startsWith('event: ')) frame.event = line.slice(7);
						else if (line.startsWith('data: ')) frame.data = JSON.parse(line.slice(6));
						else if (line.startsWith('id: ')) frame.id = line.slice(4);
					}
					if (frame.event) this.frames.push(frame as SseFrame);
					this.notify();
				}
			}
		} catch {
			// aborted
		}
		this.ended = true;
		this.notify();
	}

	private notify() {
		const waiters = this.waiters;
		this.waiters = [];
		for (const wake of waiters) wake();
	}

	async waitFor(predicate: (frame: SseFrame) => boolean, timeoutMs = 5000): Promise<SseFrame> {
		const deadline = Date.now() + timeoutMs;
		for (;;) {
			const found = this.frames.find(predicate);
			if (found) return found;
			if (this.ended)
				throw new Error(
					`stream ended; frames: ${JSON.stringify(this.frames.map((f) => f.event))}`,
				);
			const left = deadline - Date.now();
			if (left <= 0) throw new Error(`timeout; frames: ${JSON.stringify(this.frames)}`);
			await new Promise<void>((resolve) => {
				this.waiters.push(resolve);
				setTimeout(resolve, left);
			});
		}
	}

	async waitForEnd(timeoutMs = 5000) {
		const deadline = Date.now() + timeoutMs;
		while (!this.ended && Date.now() < deadline)
			await new Promise((resolve) => setTimeout(resolve, 20));
		return this.ended;
	}

	close() {
		this.controller.abort();
	}
}

describe('e2e: the SkillPouch journey over HTTP', () => {
	let h: Harness;
	let alice: Account;
	let laptop: CliClient;
	let desktop: CliClient;
	let epoch: string;
	let browserStream: SseConnection;
	const streams: SseConnection[] = [];

	beforeAll(async () => {
		h = await createHarness({}, { listen: true });
	});
	afterAll(async () => {
		for (const stream of streams) stream.close();
		await h.close();
	});

	describe('operational surface', () => {
		it('serves health and readiness without the envelope', async () => {
			expect(await (await fetch(`${h.baseUrl}/healthz`)).json()).toEqual({ status: 'ok' });
			const ready = await (await fetch(`${h.baseUrl}/readyz`)).json();
			expect(ready.status).toBe('ready');
			expect(ready.schema_version).toBeGreaterThanOrEqual(4);
		});

		it('serves Swagger UI and a complete OpenAPI document in dev/test', async () => {
			expect((await fetch(`${h.baseUrl}/docs`)).status).toBeLessThan(400);
			const spec = (await (await fetch(`${h.baseUrl}/docs/json`)).json()) as {
				openapi: string;
				paths: Record<string, unknown>;
			};
			expect(spec.openapi).toMatch(/^3\./);
			for (const path of [
				'/v1/cli-auth/requests',
				'/v1/pouches/{pouchId}/operations',
				'/v1/events/stream',
				'/v1/account/unlock/pepper',
				'/v1/account/browsers/enroll',
				'/v1/admin/users',
				'/v1/billing/webhooks/polar',
				'/v1/import/github/scan',
			]) {
				expect(Object.keys(spec.paths)).toContain(path);
			}
		});

		it('wraps errors in the envelope with a request id and security headers', async () => {
			const response = await fetch(`${h.baseUrl}/v1/pouches`, {
				headers: { 'x-request-id': 'req_e2e_trace_0001' },
			});
			expect(response.status).toBe(401);
			const body = await response.json();
			expect(body).toMatchObject({
				ok: false,
				error: { code: 'unauthenticated', status: 401 },
				meta: { request_id: 'req_e2e_trace_0001' },
			});
			expect(response.headers.get('skillpouch-request-id')).toBe('req_e2e_trace_0001');
			expect(response.headers.get('x-content-type-options')).toBe('nosniff');
			expect(response.headers.get('dpop-nonce')).toBeTruthy();
		});

		it('allows CORS only for the web origin', async () => {
			const preflight = (origin: string) =>
				fetch(`${h.baseUrl}/v1/pouches`, {
					method: 'OPTIONS',
					headers: {
						origin,
						'access-control-request-method': 'POST',
						'access-control-request-headers': 'dpop,content-type',
					},
				});
			expect((await preflight(WEB_ORIGIN)).headers.get('access-control-allow-origin')).toBe(
				WEB_ORIGIN,
			);
			expect(
				(await preflight('https://evil.example')).headers.get(
					'access-control-allow-origin',
				),
			).toBeNull();
		});
	});

	describe('journey', () => {
		it('1. onboarding on the web creates the account roster and first pouch', async () => {
			alice = await setupAccount(h, 'alice@skillpouch.test');
			const me = await alice.browser.get('/v1/me');
			expect(me.body.data.account).toMatchObject({ roster_initialized: true, roster_seq: 1 });
			expect((await alice.browser.get('/v1/account/unlock/params')).body.data.state).toBe(
				'ready',
			);
		});

		it('2. the browser opens its live event stream', async () => {
			browserStream = await SseConnection.open(h, alice.browser);
			streams.push(browserStream);
		});

		it('3. "Authorize CLI" logs two computers in with one click each', async () => {
			laptop = await authorizeCli(h, alice, 'laptop');
			desktop = await authorizeCli(h, alice, 'desktop');
			await browserStream.waitFor(
				(frame) => frame.event === 'account' && frame.data.type === 'roster.changed',
			);
			epoch = (await pouchState(laptop, alice.pouchId)).epoch;
			const devices = (await alice.browser.get('/v1/devices')).body.data.devices;
			expect(devices.map((device: { name: string }) => device.name).sort()).toEqual([
				'desktop',
				'laptop',
			]);
		});

		let artifactId: string;
		let firstRevision: string;

		it('4. the laptop syncs a skill; the browser sees it live', async () => {
			artifactId = uuidv7();
			const blobs = await uploadBlobs(laptop, alice.pouchId, 3);
			const writer: Writer = { client: laptop, memberId: laptop.memberId, key: laptop.key };
			const result = await commitOne(writer, alice.pouchId, epoch, {
				type: 'create',
				artifactId,
				baseRevisionId: null,
				nameIndex: nameIndex(),
				blobIds: blobs.map((blob) => blob.id),
			});
			expect(result.status).toBe('applied');
			firstRevision = result.revision_id;
			const frame = await browserStream.waitFor(
				(f) => f.event === 'pouch_event' && f.data.artifact_id === artifactId,
			);
			expect(frame.data).toMatchObject({
				pouch_id: alice.pouchId,
				type: 'artifact.created',
				revision_id: firstRevision,
				epoch,
			});
			expect(frame.id).toContain(`${alice.pouchId}:`);
			// The web downloads the encrypted head and its blobs.
			const list = await alice.browser.get(`/v1/pouches/${alice.pouchId}/artifacts`);
			const head = list.body.data.items.find(
				(item: { id: string }) => item.id === artifactId,
			).head;
			const fetched = await alice.browser.post(`/v1/pouches/${alice.pouchId}/blobs/fetch`, {
				ids: head.blob_ids,
			});
			expect(fetched.status).toBe(200);
		});

		it('5. the desktop catches up by long-poll and an offline edit conflicts, then resolves', async () => {
			const caughtUp = await desktop.get(
				`/v1/pouches/${alice.pouchId}/events?after=0&epoch=${epoch}&wait=5`,
			);
			expect(
				caughtUp.body.data.events.some(
					(event: { artifact_id: string }) => event.artifact_id === artifactId,
				),
			).toBe(true);

			const laptopWriter: Writer = {
				client: laptop,
				memberId: laptop.memberId,
				key: laptop.key,
			};
			const desktopWriter: Writer = {
				client: desktop,
				memberId: desktop.memberId,
				key: desktop.key,
			};
			const edit = await commitOne(laptopWriter, alice.pouchId, epoch, {
				type: 'update',
				artifactId,
				baseRevisionId: firstRevision,
			});
			const offline = await commitOne(desktopWriter, alice.pouchId, epoch, {
				type: 'update',
				artifactId,
				baseRevisionId: firstRevision,
			});
			expect(offline).toMatchObject({ status: 'conflict', conflict_type: 'update_update' });
			await browserStream.waitFor(
				(f) => f.event === 'pouch_event' && f.data.type === 'conflict.opened',
			);

			const resolved = await commitOne(desktopWriter, alice.pouchId, epoch, {
				type: 'resolve',
				artifactId,
				baseRevisionId: edit.revision_id,
				mergeParentId: offline.revision_id,
				conflictId: offline.conflict_id,
			});
			expect(resolved.status).toBe('applied');
			await browserStream.waitFor(
				(f) => f.event === 'pouch_event' && f.data.type === 'conflict.resolved',
			);
		});

		it('6. a new browser unlocks with the master password and becomes trusted', async () => {
			const fresh = await signIn(h, 'alice@skillpouch.test');
			expect((await fresh.get('/v1/account/key-envelopes')).body.error.code).toBe(
				'member_inactive',
			);
			const params = (await fresh.get('/v1/account/unlock/params')).body.data;
			const password = params.members.find(
				(member: { kind: string }) => member.kind === 'password',
			);
			expect((await fresh.post('/v1/account/unlock/pepper')).status).toBe(200);
			const envelopes = await fresh.get(
				`/v1/account/unlock/envelopes?member_id=${password.id}`,
			);
			expect(envelopes.body.data.key_envelopes.length).toBeGreaterThan(0);

			const member = await newMember('browser', fresh.key);
			const head = await rosterHead(alice.browser);
			const add = await statement(alice.passwordMember, alice.accountId, head, {
				action: 'add',
				member: memberJson(member),
			});
			const enrolled = await fresh.post('/v1/account/browsers/enroll', {
				statements: [add],
				key_envelopes: [keyEnvelope(alice.pouchId, member.id, 1, alice.passwordMember.id)],
			});
			expect(enrolled.status).toBe(200);
			await browserStream.waitFor(
				(f) => f.event === 'account' && f.data.type === 'browser.trusted',
			);
			// Next visit: no unlock needed — its own envelopes are served directly.
			expect(
				(await fresh.get('/v1/account/key-envelopes')).body.data.key_envelopes,
			).toHaveLength(1);
		});

		it('7. revoking the laptop from the web ends its stream and its access at once', async () => {
			const laptopStream = await SseConnection.open(h, laptop);
			streams.push(laptopStream);
			const revoked = await alice.browser.post(`/v1/devices/${laptop.deviceId}/revoke`, {});
			expect(revoked.status).toBe(200);
			await laptopStream.waitFor((frame) => frame.event === 'revoked');
			expect(await laptopStream.waitForEnd()).toBe(true);
			const after = await laptop.get('/v1/pouches');
			expect(after.status).toBe(401);
			expect(after.body.error.code).toBe('device_revoked');
			expect(
				(await laptop.post('/v1/devices/token', { refresh_token: laptop.refreshToken }))
					.status,
			).toBe(401);
			// The desktop keeps working.
			expect((await desktop.get('/v1/pouches')).status).toBe(200);
		});

		it("8. nobody else can see or touch alice's pouch", async () => {
			const mallory = await setupAccount(h, 'mallory@skillpouch.test');
			for (const path of [
				`/v1/pouches/${alice.pouchId}`,
				`/v1/pouches/${alice.pouchId}/artifacts`,
				`/v1/pouches/${alice.pouchId}/events?after=0&epoch=${epoch}`,
				`/v1/pouches/${alice.pouchId}/conflicts`,
			]) {
				expect((await mallory.browser.get(path)).status).toBe(404);
			}
			const theft = await mallory.browser.post(`/v1/pouches/${alice.pouchId}/blobs/check`, {
				blobs: [{ id: nameIndex(), stored_size: 10 }],
			});
			expect(theft.status).toBe(404);
		});

		it('9. graceful shutdown: readiness drops and live streams are told to reconnect', async () => {
			const stream = await SseConnection.open(h, desktop);
			streams.push(stream);
			h.health.draining = true;
			expect((await fetch(`${h.baseUrl}/readyz`)).status).toBe(503);
			for (const handle of [...openStreams]) handle.drain();
			const frame = await stream.waitFor((f) => f.event === 'reconnect');
			expect(frame.data.retry_ms).toBeGreaterThanOrEqual(0);
			expect(await stream.waitForEnd()).toBe(true);
			h.health.draining = false;
		});
	});
});
