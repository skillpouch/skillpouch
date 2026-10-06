// SPDX-License-Identifier: AGPL-3.0-only
/** Devices (CLIs) and browser members: list, refresh, revoke, reports. */
import {
	ActivePouchReport,
	CursorReport,
	DeviceList,
	DeviceTokens,
	Empty,
	IdParam,
	RefreshRequest,
	RevokeRequest,
	RevokeResponse,
} from '@skillpouch/contracts';
import { accountMembers, deviceCursors, deviceKeys, devices } from '@skillpouch/db';
import { and, asc, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';
import type { Deps } from '../../deps';
import { deviceOf, principalOf } from '../../http/principal';
import type { ZodApp } from '../../http/zod-app';
import { touchDevice, verifyRequestDpop } from '../../security/authenticate';
import { withTenantTx } from '../../security/tenant-tx';
import { findPouch } from '../pouches/pouches.service';
import { refreshDeviceTokens, revokeBrowser, revokeDevice } from './devices.service';

export async function devicesRoutes(app: ZodApp, deps: Deps) {
	app.post(
		'/v1/devices/token',
		{
			config: { auth: 'public', rateLimit: 'auth' },
			schema: {
				tags: ['devices'],
				summary: 'Refresh the access token (rotating refresh secret + DPoP proof)',
				body: RefreshRequest,
				response: { 200: DeviceTokens },
			},
		},
		async (request) => {
			const proof = await verifyRequestDpop(deps, request);
			return refreshDeviceTokens(deps, request.body.refresh_token, proof.jkt);
		},
	);

	app.get(
		'/v1/devices',
		{
			config: { auth: 'any' },
			schema: {
				tags: ['devices'],
				summary: 'All CLIs and browsers of the account',
				response: { 200: DeviceList },
			},
		},
		async (request) => {
			const principal = principalOf(request);
			return withTenantTx(deps.db.app, principal.storageAccountId, async (tx) => {
				const rows = await tx
					.select({
						device: devices,
						keyStorage: deviceKeys.keyStorage,
						memberId: accountMembers.id,
					})
					.from(devices)
					.leftJoin(
						deviceKeys,
						and(eq(deviceKeys.deviceId, devices.id), isNull(deviceKeys.retiredAt)),
					)
					.leftJoin(accountMembers, eq(accountMembers.deviceId, devices.id))
					.orderBy(asc(devices.createdAt));
				const browsers = await tx
					.select()
					.from(accountMembers)
					.where(eq(accountMembers.kind, 'browser'))
					.orderBy(asc(accountMembers.createdAt));
				return {
					devices: rows.map(({ device, keyStorage, memberId }) => ({
						id: device.id,
						name: device.name,
						os: device.os,
						arch: device.arch,
						cli_version: device.cliVersion,
						state: device.state,
						key_storage: keyStorage,
						member_id: memberId,
						active_pouch_id: device.activePouchId,
						last_seen_at: device.lastSeenAt?.toISOString() ?? null,
						revoked_at: device.revokedAt?.toISOString() ?? null,
						created_at: device.createdAt.toISOString(),
						is_current: principal.kind === 'device' && principal.deviceId === device.id,
					})),
					browsers: browsers.map((member) => ({
						member_id: member.id,
						label_enc: member.labelEnc ? member.labelEnc.toString('base64url') : null,
						last_seen_at: member.lastSeenAt?.toISOString() ?? null,
						revoked_at: member.revokedAt?.toISOString() ?? null,
						removed_seq: member.removedSeq,
						is_current: principal.memberId === member.id,
					})),
				};
			});
		},
	);

	app.post(
		'/v1/devices/:id/revoke',
		{
			config: { auth: 'any', stepUp: true },
			schema: {
				tags: ['devices'],
				summary:
					'Revoke a CLI: effective on its next request; optional signed remove + key rotation',
				params: IdParam,
				body: RevokeRequest,
				response: { 200: RevokeResponse },
			},
		},
		async (request) =>
			revokeDevice(deps, principalOf(request), request.params.id, {
				roster: request.body.roster,
				reason: request.body.reason,
			}),
	);

	app.post(
		'/v1/browsers/:id/revoke',
		{
			config: { auth: 'any', stepUp: true },
			schema: {
				tags: ['devices'],
				summary: 'Revoke a browser member (ends its sessions)',
				params: IdParam,
				body: RevokeRequest,
				response: { 200: RevokeResponse },
			},
		},
		async (request) =>
			revokeBrowser(deps, principalOf(request), request.params.id, {
				roster: request.body.roster,
			}),
	);

	app.put(
		'/v1/devices/me/cursor',
		{
			config: { auth: 'device' },
			schema: {
				tags: ['devices'],
				summary: 'Report the acknowledged event seq of a pouch',
				body: CursorReport,
				response: { 200: Empty },
			},
		},
		async (request) => {
			const principal = deviceOf(request);
			await touchDevice(deps, principal);
			await withTenantTx(deps.db.app, principal.storageAccountId, async (tx) => {
				await findPouch(tx, request.body.pouch_id);
				await tx
					.insert(deviceCursors)
					.values({
						storageAccountId: principal.storageAccountId,
						deviceId: principal.deviceId,
						pouchId: request.body.pouch_id,
						epoch: request.body.epoch,
						ackedSeq: request.body.acked_seq,
					})
					.onConflictDoUpdate({
						target: [deviceCursors.deviceId, deviceCursors.pouchId],
						set: {
							epoch: request.body.epoch,
							ackedSeq: request.body.acked_seq,
							updatedAt: deps.now(),
						},
					});
			});
			return {};
		},
	);

	app.put(
		'/v1/devices/me/active-pouch',
		{
			config: { auth: 'device' },
			schema: {
				tags: ['devices'],
				summary: 'Report the active pouch (display only)',
				body: ActivePouchReport,
				response: { 200: Empty },
			},
		},
		async (request) => {
			const principal = deviceOf(request);
			await withTenantTx(deps.db.app, principal.storageAccountId, async (tx) => {
				if (request.body.pouch_id) await findPouch(tx, request.body.pouch_id);
				await tx
					.update(devices)
					.set({ activePouchId: request.body.pouch_id })
					.where(eq(devices.id, principal.deviceId));
			});
			return {};
		},
	);

	app.get(
		'/v1/devices/me/cursors',
		{
			config: { auth: 'device' },
			schema: {
				tags: ['devices'],
				response: { 200: z.object({ cursors: z.array(CursorReport) }) },
			},
		},
		async (request) => {
			const principal = deviceOf(request);
			return withTenantTx(deps.db.app, principal.storageAccountId, async (tx) => {
				const rows = await tx
					.select()
					.from(deviceCursors)
					.where(eq(deviceCursors.deviceId, principal.deviceId));
				return {
					cursors: rows.map((row) => ({
						pouch_id: row.pouchId,
						epoch: row.epoch,
						acked_seq: row.ackedSeq,
					})),
				};
			});
		},
	);
}
