// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Account-wide SSE stream.
 *
 * On connect the server replays events after the client's per-pouch cursors,
 * then forwards new events as they are committed (listen hub). Frame ids are
 * the full cursor map, so `Last-Event-ID` resumes every pouch at once.
 *
 *   event: pouch_event   data: {pouch_id, seq, epoch, type, artifact_id, revision_id, …}
 *   event: account       data: {type, data}     (roster.changed, device.revoked, …)
 *   event: reconnect     data: {retry_ms}       (server draining — reconnect elsewhere)
 *   event: revoked       data: {}               (this device was revoked; stream ends)
 */
import { pouches } from '@skillpouch/db';
import { eq } from 'drizzle-orm';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Deps } from '../../deps';
import { AppError } from '../../http/app-error';
import { principalOf } from '../../http/principal';
import type { Principal } from '../../security/principal';
import { withTenantTx } from '../../security/tenant-tx';
import { eventView, readEvents } from './events.repo';

const HEARTBEAT_MS = 15_000;
/**
 * A stream lives 10–15 min (jittered so clients don't reconnect in waves),
 * then asks the client to reconnect. That re-runs authentication, so a
 * signed-out session or a suspended user can't keep an old stream open, while
 * 100 000 open streams cost ~140 reconnects/s instead of ~400 at 4–5 min.
 * Revoked devices are cut off at once regardless (device_revoked notify).
 */
const MAX_LIFETIME_MS = 600_000;
const LIFETIME_JITTER_MS = 300_000;
const UUID = /^[0-9a-f-]{36}$/;

/** Live streams of this instance, so graceful shutdown can tell them to reconnect. */
export const openStreams = new Set<{ drain(): void }>();

export function parseCursors(text: string | undefined): Map<string, number> {
	const cursors = new Map<string, number>();
	for (const part of (text ?? '').split(',').filter(Boolean)) {
		const [pouchId, seq] = part.split(':');
		const value = Number(seq);
		if (!pouchId || !UUID.test(pouchId) || !Number.isInteger(value) || value < 0) {
			throw new AppError('validation_failed', {
				reason: 'cursors must be <pouch_id>:<seq>,…',
			});
		}
		cursors.set(pouchId, value);
	}
	return cursors;
}

function formatCursors(cursors: Map<string, number>): string {
	return [...cursors].map(([pouchId, seq]) => `${pouchId}:${seq}`).join(',');
}

export async function openEventStream(deps: Deps, request: FastifyRequest, reply: FastifyReply) {
	const principal: Principal = principalOf(request);
	const query = request.query as { cursors?: string };
	const lastEventId = request.headers['last-event-id'];
	const cursors = parseCursors(
		query.cursors ?? (typeof lastEventId === 'string' ? lastEventId : undefined),
	);

	// Every pouch of the account is streamed; unknown pouch ids in the cursor are rejected.
	const accountPouches = await withTenantTx(deps.db.app, principal.storageAccountId, (tx) =>
		tx
			.select({ id: pouches.id, epoch: pouches.epoch, eventSeq: pouches.eventSeq })
			.from(pouches),
	);
	const known = new Map(accountPouches.map((pouch) => [pouch.id, pouch]));
	for (const pouchId of cursors.keys()) if (!known.has(pouchId)) throw new AppError('not_found');
	for (const pouch of accountPouches)
		if (!cursors.has(pouch.id)) cursors.set(pouch.id, pouch.eventSeq);

	reply.hijack();
	const raw = reply.raw;
	raw.writeHead(200, {
		'Content-Type': 'text/event-stream; charset=utf-8',
		'Cache-Control': 'no-cache, no-transform',
		Connection: 'keep-alive',
		'X-Accel-Buffering': 'no',
		'Skillpouch-Request-Id': request.id,
		'Access-Control-Allow-Origin': deps.env.WEB_ORIGIN,
		'Access-Control-Allow-Credentials': 'true',
	});

	let closed = false;
	let sending = Promise.resolve();
	const write = (event: string, data: unknown) => {
		if (closed) return;
		raw.write(
			`id: ${formatCursors(cursors)}\nevent: ${event}\ndata: ${JSON.stringify(data)}\n\n`,
		);
	};

	const flushPouch = (pouchId: string) => {
		sending = sending
			.then(async () => {
				if (closed) return;
				const after = cursors.get(pouchId) ?? 0;
				const rows = await withTenantTx(
					deps.db.app,
					principal.storageAccountId,
					async (tx) => {
						const [pouch] = await tx
							.select({ epoch: pouches.epoch })
							.from(pouches)
							.where(eq(pouches.id, pouchId));
						return pouch
							? {
									epoch: pouch.epoch,
									rows: await readEvents(tx, pouchId, after, 500),
								}
							: null;
					},
				);
				if (!rows) return;
				for (const row of rows.rows) {
					cursors.set(pouchId, row.seq);
					write('pouch_event', {
						pouch_id: pouchId,
						epoch: rows.epoch,
						...eventView(row),
					});
				}
				if (rows.rows.length === 500) flushPouch(pouchId);
			})
			.catch((error) => {
				request.log.warn({ err: error }, 'sse flush failed');
			});
	};

	const close = () => {
		if (closed) return;
		closed = true;
		clearInterval(heartbeat);
		clearTimeout(expiry);
		unsubscribe();
		unsubscribeRevoked();
		openStreams.delete(handle);
		raw.end();
	};

	const unsubscribe = deps.hub.subscribeAccount(principal.storageAccountId, (event) => {
		if (event.kind === 'pouch') {
			const pouchId = String(event.p);
			if (!cursors.has(pouchId)) cursors.set(pouchId, 0);
			flushPouch(pouchId);
		} else if (event.kind === 'account') {
			sending = sending.then(() => write('account', { type: event.type, data: event.data }));
		} else if (event.kind === 'reconnect') {
			for (const pouchId of cursors.keys()) flushPouch(pouchId);
		}
	});
	const unsubscribeRevoked = deps.hub.onDeviceRevoked((event) => {
		if (principal.kind === 'device' && event.d === principal.deviceId) {
			sending = sending.then(() => {
				write('revoked', {});
				close();
			});
		}
	});
	const heartbeat = setInterval(() => {
		if (!closed) raw.write(': ping\n\n');
	}, HEARTBEAT_MS);
	const handle = {
		drain: () => {
			write('reconnect', { retry_ms: Math.floor(Math.random() * 5000) });
			close();
		},
	};
	openStreams.add(handle);
	const expiry = setTimeout(handle.drain, MAX_LIFETIME_MS + Math.random() * LIFETIME_JITTER_MS);
	request.raw.once('close', close);

	raw.write(`retry: 3000\n\n`);
	for (const pouchId of cursors.keys()) flushPouch(pouchId);
}
