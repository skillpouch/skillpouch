// SPDX-License-Identifier: AGPL-3.0-only
/** Pouch lifecycle routes (plan 06 §3, 15 §7.5, 16 §1). */
import { Pouch, PouchCreate, PouchParam, PouchUpdate } from '@skillpouch/contracts';
import { pouches } from '@skillpouch/db';
import { asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import type { Deps } from '../../deps';
import { AppError } from '../../http/app-error';
import { memberOf, principalOf } from '../../http/principal';
import type { ZodApp } from '../../http/zod-app';
import { notifyAccount } from '../../infra/notify';
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
			config: { auth: 'any' },
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
				summary: 'Delete a pouch (7-day undo window, then purged)',
				params: PouchParam,
				response: { 200: Pouch },
			},
		},
		async (request) => {
			const principal = principalOf(request);
			return withTenantTx(deps.db.app, principal.storageAccountId, async (tx) => {
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
				});
				return pouchView(deleted);
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
