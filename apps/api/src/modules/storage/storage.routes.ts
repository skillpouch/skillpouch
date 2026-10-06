// SPDX-License-Identifier: AGPL-3.0-only
/** Storage usage and "Free up space" routes. Web only. */
import {
	FreeSpaceRequest,
	FreeSpaceResponse,
	PouchParam,
	StorageUsage,
} from '@skillpouch/contracts';
import type { Deps } from '../../deps';
import { sessionOf } from '../../http/principal';
import type { ZodApp } from '../../http/zod-app';
import { notifyAccount } from '../../infra/notify';
import { principalLabel } from '../../security/principal';
import { withTenantTx } from '../../security/tenant-tx';
import { freeSpace, storageUsage } from './storage.service';

export async function storageRoutes(app: ZodApp, deps: Deps) {
	app.get(
		'/v1/account/storage',
		{
			config: { auth: 'session' },
			schema: {
				tags: ['account'],
				summary: 'Storage used per pouch and per item (sizes only; names stay encrypted)',
				response: { 200: StorageUsage },
			},
		},
		async (request) => {
			const principal = sessionOf(request);
			return withTenantTx(deps.db.app, principal.storageAccountId, (tx) =>
				storageUsage(tx, principal.storageAccountId),
			);
		},
	);

	app.post(
		'/v1/pouches/:pouchId/free-space',
		{
			config: { auth: 'session' },
			schema: {
				tags: ['pouches'],
				summary:
					'Remove older versions now: all history + trash of the pouch, or of the listed deleted items',
				params: PouchParam,
				body: FreeSpaceRequest,
				response: { 200: FreeSpaceResponse },
			},
		},
		async (request) => {
			const principal = sessionOf(request);
			const result = await freeSpace(deps, {
				storageAccountId: principal.storageAccountId,
				pouchId: request.params.pouchId,
				artifactIds: request.body.artifact_ids,
				actor: principalLabel(principal),
			});
			await withTenantTx(deps.db.app, principal.storageAccountId, (tx) =>
				notifyAccount(tx, principal.storageAccountId, 'usage.changed'),
			);
			return result;
		},
	);
}
