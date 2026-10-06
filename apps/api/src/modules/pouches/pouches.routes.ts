// SPDX-License-Identifier: AGPL-3.0-only
/** Pouch lifecycle routes (plan 06 §3, 15 §7.5, 16 §1). */
import {
	Pouch,
	PouchActivate,
	PouchCreate,
	PouchDeleteQuery,
	PouchParam,
	PouchUpdate,
} from '@skillpouch/contracts';
import { pouches, storageAccounts } from '@skillpouch/db';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import type { Deps } from '../../deps';
import { AppError } from '../../http/app-error';
import { memberOf, principalOf, sessionOf } from '../../http/principal';
import type { ZodApp } from '../../http/zod-app';
import { notifyAccount } from '../../infra/notify';
import { purgePouchNow } from '../../jobs/purge';
import { appendAudit } from '../../security/audit';
import { parseRosterStatement } from '../../security/e2ee-structure';
import { principalLabel } from '../../security/principal';
import { withTenantTx } from '../../security/tenant-tx';
import { refreshEntitlementsInTx } from '../entitlements/entitlements.service';
import {
	appendStatements,
	assertEnvelopeCoverage,
	insertKeyEnvelopes,
} from '../roster/roster.service';
import { assertPouchAllowance, findPouch, markPouchDeleted, pouchView } from './pouches.service';

export async function pouchesRoutes(app: ZodApp, deps: Deps) {
	app.get(
		'/v1/pouches',
		{
			config: { auth: 'any' },
			schema: {
				tags: ['pouches'],
				summary:
					'List the account’s pouches (including deleted ones still in their undo window)',
				response: { 200: z.object({ pouches: z.array(Pouch) }) },
			},
		},
		async (request) => {
			const principal = principalOf(request);
			return withTenantTx(deps.db.app, principal.storageAccountId, async (tx) => {
				const rows = await tx.select().from(pouches).orderBy(asc(pouches.createdAt));
				return { pouches: rows.map(pouchView) };
			});
		},
	);

	app.get(
		'/v1/pouches/:pouchId',
		{
			// The CLI must be able to see that a pouch is locked (18 §3.3).
			config: { auth: 'any', lockedPouchOk: true },
			schema: { tags: ['pouches'], params: PouchParam, response: { 200: Pouch } },
		},
		async (request) => {
			const principal = principalOf(request);
			return withTenantTx(deps.db.app, principal.storageAccountId, async (tx) =>
				pouchView(await findPouch(tx, request.params.pouchId, { includeDeleted: true })),
			);
		},
	);

	app.post(
		'/v1/pouches',
		{
			config: { auth: 'any' },
			schema: {
				tags: ['pouches'],
				summary:
					'Create a pouch: signed create_pouch statement + key envelopes for every member',
				body: PouchCreate,
				response: { 200: Pouch },
			},
		},
		async (request) => {
			const principal = principalOf(request);
			const signer = memberOf(principal);
			return withTenantTx(deps.db.app, principal.storageAccountId, async (tx) => {
				const result = await appendStatements(tx, [request.body.statement], {
					storageAccountId: principal.storageAccountId,
					requiredSigner: signer,
					allowedActions: new Set(['create_pouch']),
					beforeCreatePouch: (innerTx) =>
						assertPouchAllowance(innerTx, principal.storageAccountId),
				});
				const pouchId = result.createdPouchIds[0]!;
				await insertKeyEnvelopes(
					tx,
					principal.storageAccountId,
					request.body.key_envelopes,
				);
				await assertEnvelopeCoverage(tx, [pouchId]);
				await appendAudit(tx, {
					storageAccountId: principal.storageAccountId,
					actor: principalLabel(principal),
					action: 'pouch.created',
					target: `pouch:${pouchId}`,
				});
				return pouchView(await findPouch(tx, pouchId));
			});
		},
	);

	app.patch(
		'/v1/pouches/:pouchId',
		{
			config: { auth: 'any' },
			schema: {
				tags: ['pouches'],
				summary: 'Rename or archive a pouch with a signed statement',
				params: PouchParam,
				body: PouchUpdate,
				response: { 200: Pouch },
			},
		},
		async (request) => {
			const principal = principalOf(request);
			const signer = memberOf(principal);
			const body = parseRosterStatement(request.body.statement.statement).body;
			if (body.pouch?.id !== request.params.pouchId)
				throw new AppError('roster_invalid', { reason: 'pouch id' });
			return withTenantTx(deps.db.app, principal.storageAccountId, async (tx) => {
				await appendStatements(tx, [request.body.statement], {
					storageAccountId: principal.storageAccountId,
					requiredSigner: signer,
					allowedActions: new Set(['rename_pouch', 'archive_pouch']),
				});
				return pouchView(await findPouch(tx, request.params.pouchId));
			});
		},
	);

	app.delete(
		'/v1/pouches/:pouchId',
		{
			config: { auth: 'any', stepUp: true },
			schema: {
				tags: ['pouches'],
				summary:
					'Delete a pouch (7-day undo window, then purged; `skip_undo=true` purges now to free space)',
				params: PouchParam,
				querystring: PouchDeleteQuery,
				response: { 200: Pouch },
			},
		},
		async (request) => {
			const principal = principalOf(request);
			const skipUndo = request.query.skip_undo === 'true';
			const view = await withTenantTx(deps.db.app, principal.storageAccountId, async (tx) => {
				const pouch = await findPouch(tx, request.params.pouchId, { lock: true });
				const deleted = await markPouchDeleted(tx, pouch, deps.now());
				await refreshEntitlementsInTx(tx, principal.storageAccountId, deps.now());
				await notifyAccount(tx, principal.storageAccountId, 'pouch.state_changed', {
					pouch_id: pouch.id,
				});
				await appendAudit(tx, {
					storageAccountId: principal.storageAccountId,
					actor: principalLabel(principal),
					action: 'pouch.deleted',
					target: `pouch:${pouch.id}`,
					details: { skip_undo: skipUndo },
				});
				return pouchView(deleted);
			});
			if (skipUndo) {
				await purgePouchNow(deps, principal.storageAccountId, view.id);
				await withTenantTx(deps.db.app, principal.storageAccountId, (tx) =>
					notifyAccount(tx, principal.storageAccountId, 'usage.changed'),
				);
			}
			return view;
		},
	);

	app.post(
		'/v1/pouches/:pouchId/activate',
		{
			config: { auth: 'session' },
			schema: {
				tags: ['pouches'],
				summary:
					'Make a locked pouch active; at the plan limit `lock_pouch_id` names the active pouch to lock instead',
				params: PouchParam,
				body: PouchActivate,
				response: { 200: z.object({ pouches: z.array(Pouch) }) },
			},
		},
		async (request) => {
			const principal = sessionOf(request);
			return withTenantTx(deps.db.app, principal.storageAccountId, async (tx) => {
				const pouch = await findPouch(tx, request.params.pouchId, { lock: true });
				const changed: string[] = [];
				if (pouch.state === 'locked') {
					const [account] = await tx
						.select({ entitlements: storageAccounts.entitlements })
						.from(storageAccounts)
						.where(eq(storageAccounts.id, principal.storageAccountId));
					const limit = account?.entitlements.pouch_limit ?? 0;
					const active = await tx
						.select({ id: pouches.id })
						.from(pouches)
						.where(eq(pouches.state, 'active'))
						.for('update');
					const swapWith = request.body.lock_pouch_id;
					if (active.length >= limit) {
						if (!swapWith || !active.some((row) => row.id === swapWith)) {
							throw new AppError('pouch_limit_reached', {
								limit,
								active_pouch_ids: active.map((row) => row.id),
								hint: 'pass lock_pouch_id of an active pouch to swap',
							});
						}
						await tx
							.update(pouches)
							.set({ state: 'locked', updatedAt: deps.now() })
							.where(and(eq(pouches.id, swapWith), eq(pouches.state, 'active')));
						changed.push(swapWith);
					}
					await tx
						.update(pouches)
						.set({ state: 'active', updatedAt: deps.now() })
						.where(eq(pouches.id, pouch.id));
					changed.push(pouch.id);
				} else if (pouch.state !== 'active') {
					throw new AppError('pouch_read_only', { state: pouch.state });
				}
				for (const pouchId of changed) {
					await notifyAccount(tx, principal.storageAccountId, 'pouch.state_changed', {
						pouch_id: pouchId,
					});
				}
				if (changed.length > 0) {
					await appendAudit(tx, {
						storageAccountId: principal.storageAccountId,
						actor: principalLabel(principal),
						action: 'pouch.activated',
						target: `pouch:${pouch.id}`,
						details: { locked: changed.filter((id) => id !== pouch.id) },
					});
				}
				const rows = await tx
					.select()
					.from(pouches)
					.where(inArray(pouches.state, ['active', 'locked', 'archived', 'deleted']))
					.orderBy(asc(pouches.createdAt));
				return { pouches: rows.map(pouchView) };
			});
		},
	);

	app.post(
		'/v1/pouches/:pouchId/restore',
		{
			config: { auth: 'any' },
			schema: {
				tags: ['pouches'],
				summary: 'Undo a pouch deletion within the undo window',
				params: PouchParam,
				response: { 200: Pouch },
			},
		},
		async (request) => {
			const principal = principalOf(request);
			return withTenantTx(deps.db.app, principal.storageAccountId, async (tx) => {
				const pouch = await findPouch(tx, request.params.pouchId, {
					lock: true,
					includeDeleted: true,
				});
				if (pouch.state !== 'deleted') return pouchView(pouch);
				if (!pouch.deleteAfter || pouch.deleteAfter <= deps.now())
					throw new AppError('not_found');
				await assertPouchAllowance(tx, principal.storageAccountId);
				await tx
					.update(pouches)
					.set({ state: 'active', deleteAfter: null, updatedAt: deps.now() })
					.where(eq(pouches.id, pouch.id));
				await refreshEntitlementsInTx(tx, principal.storageAccountId, deps.now());
				await notifyAccount(tx, principal.storageAccountId, 'pouch.state_changed', {
					pouch_id: pouch.id,
				});
				return pouchView(await findPouch(tx, pouch.id));
			});
		},
	);
}
