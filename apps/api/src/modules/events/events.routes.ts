// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Event feed: pull with long-poll fallback, plus the
 * account-wide SSE stream. Correctness never depends on the
 * stream: clients pull after every (re)connect.
 */
import { EventsQuery, EventsResponse, PouchParam } from '@skillpouch/contracts';
import type { Deps } from '../../deps';
import { AppError } from '../../http/app-error';
import { principalOf } from '../../http/principal';
import type { ZodApp } from '../../http/zod-app';
import { touchDevice } from '../../security/authenticate';
import { withTenantTx } from '../../security/tenant-tx';
import { findPouch } from '../pouches/pouches.service';
import { eventView, readEvents } from './events.repo';
import { openEventStream } from './event-stream';

export async function eventsRoutes(app: ZodApp, deps: Deps) {
	app.get(
		'/v1/pouches/:pouchId/events',
		{
			// The locked check happens in the read below (it loads the pouch anyway).
			config: { auth: 'any', lockedPouchOk: true },
			schema: {
				tags: ['sync'],
				summary: 'Events after a cursor; `wait` (≤ 25 s) long-polls when there are none',
				params: PouchParam,
				querystring: EventsQuery,
				response: { 200: EventsResponse },
			},
		},
		async (request) => {
			const principal = principalOf(request);
			if (principal.kind === 'device') await touchDevice(deps, principal);
			const { after, epoch, limit, wait } = request.query;
			const controller = new AbortController();
			request.raw.once('close', () => controller.abort());

			const read = () =>
				withTenantTx(deps.db.app, principal.storageAccountId, async (tx) => {
					const pouch = await findPouch(tx, request.params.pouchId, {
						includeDeleted: true,
					});
					if (principal.kind === 'device' && pouch.state === 'locked') {
						throw new AppError('pouch_locked');
					}
					if (pouch.epoch !== epoch)
						throw new AppError('epoch_mismatch', { epoch: pouch.epoch });
					if (after < pouch.eventsPurgedThrough) {
						throw new AppError('cursor_expired', {
							oldest_seq: pouch.eventsPurgedThrough + 1,
						});
					}
					const rows = await readEvents(tx, pouch.id, after, limit);
					return { rows, pouch };
				});

			// Subscribe before reading: a commit that lands after the read's snapshot
			// always wakes us, so a wait that times out needs no second read.
			const waiting =
				wait > 0
					? deps.hub.waitForPouch(request.params.pouchId, wait * 1000, controller.signal)
					: null;
			let { rows, pouch } = await read().catch((error: unknown) => {
				controller.abort();
				throw error;
			});
			if (rows.length > 0 || !waiting) {
				controller.abort();
			} else if ((await waiting) === 'notified') {
				({ rows, pouch } = await read());
			}
			return {
				events: rows.map(eventView),
				next_cursor: rows.at(-1)?.seq ?? after,
				high_water: pouch.eventSeq,
				epoch: pouch.epoch,
			};
		},
	);

	app.get(
		'/v1/events/stream',
		{
			config: { auth: 'any', raw: true },
			schema: {
				tags: ['sync'],
				summary:
					'Account-wide Server-Sent Events: pouch events + account events (roster, revoke, …)',
				description:
					'Resume with `?cursors=<pouch_id>:<seq>,…` or the `Last-Event-ID` header (same format). Frames: `pouch_event`, `account`, `reconnect`, `revoked`.',
			},
		},
		async (request, reply) => openEventStream(deps, request, reply),
	);
}
