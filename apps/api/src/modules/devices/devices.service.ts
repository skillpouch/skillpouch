// SPDX-License-Identifier: AGPL-3.0-only
/**
 * CLI device credentials: DPoP-bound access tokens, rotating
 * refresh secrets with reuse detection, and revocation.
 */
import { randomUUID } from 'node:crypto';
import type { RosterAppendRequest } from '@skillpouch/contracts';
import {
	accountMembers,
	deviceCursors,
	deviceKeys,
	devices,
	securityEvents,
	sessions,
} from '@skillpouch/db';
import { and, asc, eq, isNull } from 'drizzle-orm';
import type { Deps } from '../../deps';
import { AppError } from '../../http/app-error';
import { notifyAccount, notifyDeviceRevoked } from '../../infra/notify';
import { appendAudit } from '../../security/audit';
import { randomToken, sha256 } from '../../security/crypto-util';
import type { DevicePrincipal, Principal } from '../../security/principal';
import { principalLabel } from '../../security/principal';
import type { TenantTx } from '../../security/tenant-tx';
import { withTenantTx } from '../../security/tenant-tx';
import {
	appendStatements,
	assertEnvelopeCoverage,
	insertKeyEnvelopes,
} from '../roster/roster.service';

const REFRESH_PREFIX = 'spr1';

export interface ParsedRefreshToken {
	storageAccountId: string;
	deviceId: string;
	secret: string;
}

/** `spr1.<storage account>.<device>.<secret>` — the ids let us open the right tenant transaction. */
export function formatRefreshToken(
	storageAccountId: string,
	deviceId: string,
	secret: string,
): string {
	return `${REFRESH_PREFIX}.${storageAccountId}.${deviceId}.${secret}`;
}

export function parseRefreshToken(token: string): ParsedRefreshToken {
	const [prefix, storageAccountId, deviceId, secret, extra] = token.split('.');
	const uuid = /^[0-9a-f-]{36}$/;
	if (
		prefix !== REFRESH_PREFIX ||
		extra !== undefined ||
		!storageAccountId ||
		!deviceId ||
		!secret
	) {
		throw new AppError('refresh_invalid');
	}
	if (!uuid.test(storageAccountId) || !uuid.test(deviceId)) throw new AppError('refresh_invalid');
	return { storageAccountId, deviceId, secret };
}

/** Rotates the refresh secret and issues a new token pair (inside the caller's tx). */
export async function issueDeviceTokens(
	deps: Deps,
	tx: TenantTx,
	device: typeof devices.$inferSelect,
	jkt: string,
	options: { newFamily: boolean },
) {
	const secret = randomToken(32);
	await tx
		.update(devices)
		.set({
			refreshHash: sha256(secret),
			prevRefreshHash: options.newFamily ? null : device.refreshHash,
			refreshFamilyId: options.newFamily ? randomUUID() : device.refreshFamilyId,
			lastSeenAt: deps.now(),
		})
		.where(eq(devices.id, device.id));
	const { token, expiresIn } = await deps.tokens.issue({
		sub: device.userId,
		sa: device.storageAccountId,
		did: device.id,
		jkt,
		ver: device.tokenVersion,
		scope: 'sync',
	});
	return {
		token_type: 'DPoP' as const,
		access_token: token,
		expires_in: expiresIn,
		refresh_token: formatRefreshToken(device.storageAccountId, device.id, secret),
		device_id: device.id,
		storage_account_id: device.storageAccountId,
	};
}

/** `POST /v1/devices/token`: refresh with rotation + reuse detection. */
export async function refreshDeviceTokens(deps: Deps, refreshToken: string, jkt: string) {
	const parsed = parseRefreshToken(refreshToken);
	const outcome = await withTenantTx(deps.db.app, parsed.storageAccountId, async (tx) => {
		const [device] = await tx
			.select()
			.from(devices)
			.where(eq(devices.id, parsed.deviceId))
			.for('update');
		if (!device) throw new AppError('refresh_invalid');
		const [key] = await tx
			.select()
			.from(deviceKeys)
			.where(
				and(
					eq(deviceKeys.deviceId, device.id),
					eq(deviceKeys.jkt, jkt),
					isNull(deviceKeys.retiredAt),
				),
			);
		if (device.state === 'revoked') throw new AppError('device_revoked');
		if (device.state === 'suspended') throw new AppError('device_suspended');
		if (!key) throw new AppError('dpop_invalid', { reason: 'not this device’s key' });

		const presented = sha256(parsed.secret);
		if (presented.equals(device.refreshHash)) {
			return { tokens: await issueDeviceTokens(deps, tx, device, jkt, { newFamily: false }) };
		}
		if (device.prevRefreshHash && presented.equals(device.prevRefreshHash)) {
			await revokeDeviceRow(tx, device, 'refresh_reuse', deps.now());
			await tx.insert(securityEvents).values({
				storageAccountId: device.storageAccountId,
				kind: 'refresh_reuse',
				severity: 'critical',
				details: { device_id: device.id, device_name: device.name },
			});
			await appendAudit(tx, {
				storageAccountId: device.storageAccountId,
				actor: 'system',
				action: 'device.revoked',
				target: `device:${device.id}`,
				details: { reason: 'refresh_reuse' },
			});
			return { reused: true as const };
		}
		throw new AppError('refresh_invalid');
	});
	if ('reused' in outcome) {
		deps.deviceStatus.invalidate(parsed.deviceId);
		throw new AppError('refresh_reused');
	}
	return outcome.tokens;
}

/** Marks a device revoked: state, token version, keys retired, member flagged, notifications. */
export async function revokeDeviceRow(
	tx: TenantTx,
	device: typeof devices.$inferSelect,
	reason: string,
	now: Date,
) {
	await tx
		.update(devices)
		.set({
			state: 'revoked',
			revokedAt: now,
			revokeReason: reason,
			tokenVersion: device.tokenVersion + 1,
			refreshHash: sha256(randomToken(32)),
			prevRefreshHash: null,
		})
		.where(eq(devices.id, device.id));
	await tx
		.update(deviceKeys)
		.set({ retiredAt: now })
		.where(and(eq(deviceKeys.deviceId, device.id), isNull(deviceKeys.retiredAt)));
	await tx
		.update(accountMembers)
		.set({ revokedAt: now })
		.where(and(eq(accountMembers.deviceId, device.id), isNull(accountMembers.revokedAt)));
	await notifyDeviceRevoked(tx, device.storageAccountId, device.id);
	await notifyAccount(tx, device.storageAccountId, 'device.revoked', { device_id: device.id });
}

/**
 * Revokes a CLI. The server-side part is immediate. When the caller
 * is an unlocked member it also sends the signed `remove` + `rotate_keys`
 * statements and new key envelopes; otherwise rotation stays pending and the
 * next member that unlocks finishes it.
 */
export async function revokeDevice(
	deps: Deps,
	principal: Principal,
	deviceId: string,
	input: { roster?: RosterAppendRequest | undefined; reason?: string | undefined },
) {
	const result = await withTenantTx(deps.db.app, principal.storageAccountId, async (tx) => {
		const [device] = await tx
			.select()
			.from(devices)
			.where(eq(devices.id, deviceId))
			.for('update');
		if (!device) throw new AppError('not_found');
		if (device.state !== 'revoked') {
			await revokeDeviceRow(tx, device, input.reason ?? 'revoked_by_user', deps.now());
			await tx.insert(securityEvents).values({
				storageAccountId: principal.storageAccountId,
				kind: 'device.revoked',
				severity: 'info',
				details: {
					device_id: device.id,
					device_name: device.name,
					by: principalLabel(principal),
				},
			});
			await appendAudit(tx, {
				storageAccountId: principal.storageAccountId,
				actor: principalLabel(principal),
				action: 'device.revoked',
				target: `device:${device.id}`,
				details: { reason: input.reason ?? 'revoked_by_user' },
			});
		}
		return finishRemoval(tx, principal, { deviceId: device.id }, input.roster);
	});
	deps.deviceStatus.invalidate(deviceId);
	return result;
}

/** Revokes a browser member: its sessions end now; roster removal as for devices. */
export async function revokeBrowser(
	deps: Deps,
	principal: Principal,
	memberId: string,
	input: { roster?: RosterAppendRequest | undefined },
) {
	return withTenantTx(deps.db.app, principal.storageAccountId, async (tx) => {
		const [member] = await tx
			.select()
			.from(accountMembers)
			.where(and(eq(accountMembers.id, memberId), eq(accountMembers.kind, 'browser')))
			.for('update');
		if (!member) throw new AppError('not_found');
		if (!member.revokedAt) {
			await tx
				.update(accountMembers)
				.set({ revokedAt: deps.now() })
				.where(eq(accountMembers.id, member.id));
			if (member.sessionJkt)
				await tx.delete(sessions).where(eq(sessions.jkt, member.sessionJkt));
			await notifyAccount(tx, principal.storageAccountId, 'device.revoked', {
				member_id: member.id,
			});
			await appendAudit(tx, {
				storageAccountId: principal.storageAccountId,
				actor: principalLabel(principal),
				action: 'browser.revoked',
				target: `member:${member.id}`,
			});
		}
		return finishRemoval(tx, principal, { memberId: member.id }, input.roster);
	});
}

async function finishRemoval(
	tx: TenantTx,
	principal: Principal,
	target: { deviceId?: string; memberId?: string },
	roster: RosterAppendRequest | undefined,
) {
	const [member] = await tx
		.select()
		.from(accountMembers)
		.where(
			target.deviceId
				? eq(accountMembers.deviceId, target.deviceId)
				: eq(accountMembers.id, target.memberId!),
		);
	if (roster && member && member.removedSeq === null) {
		if (!principal.memberId || principal.memberId === member.id)
			throw new AppError('member_inactive');
		const appended = await appendStatements(tx, roster.statements, {
			storageAccountId: principal.storageAccountId,
			requiredSigner: principal.memberId,
			allowedActions: new Set(['remove', 'rotate_keys']),
		});
		if (!appended.removedMemberIds.includes(member.id)) {
			throw new AppError('roster_invalid', {
				reason: 'statements must remove the revoked member',
			});
		}
		await insertKeyEnvelopes(tx, principal.storageAccountId, roster.key_envelopes);
		await assertEnvelopeCoverage(tx);
	}
	const [after] = member
		? await tx
				.select({ removedSeq: accountMembers.removedSeq })
				.from(accountMembers)
				.where(eq(accountMembers.id, member.id))
		: [];
	return {
		revoked: true as const,
		rotation_pending: member !== undefined && after?.removedSeq === null,
	};
}

/** Devices page: every CLI (with its sync cursors) and every browser member of the account. */
export async function listDevices(deps: Deps, principal: Principal) {
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
		const cursors = await tx
			.select({
				deviceId: deviceCursors.deviceId,
				pouchId: deviceCursors.pouchId,
				ackedSeq: deviceCursors.ackedSeq,
			})
			.from(deviceCursors);
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
				assistants: device.assistants,
				cursors: cursors
					.filter((cursor) => cursor.deviceId === device.id)
					.map((cursor) => ({ pouch_id: cursor.pouchId, acked_seq: cursor.ackedSeq })),
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
}

/** Rename a CLI. The web may rename any device of the account; a CLI only itself. */
export async function renameDevice(
	deps: Deps,
	principal: Principal,
	deviceId: string,
	name: string,
) {
	if (principal.kind === 'device' && principal.deviceId !== deviceId)
		throw new AppError('not_found');
	return withTenantTx(deps.db.app, principal.storageAccountId, async (tx) => {
		const [device] = await tx
			.update(devices)
			.set({ name })
			.where(eq(devices.id, deviceId))
			.returning({ id: devices.id });
		if (!device) throw new AppError('not_found');
		await appendAudit(tx, {
			storageAccountId: principal.storageAccountId,
			actor: principalLabel(principal),
			action: 'device.renamed',
			target: `device:${deviceId}`,
		});
		return {};
	});
}

/** The CLI reports its version and the assistants it found on this computer. */
export async function reportDevice(
	deps: Deps,
	principal: DevicePrincipal,
	report: { cli_version?: string | undefined; assistants?: string[] | undefined },
) {
	const changes: Partial<typeof devices.$inferInsert> = {};
	if (report.cli_version !== undefined) changes.cliVersion = report.cli_version;
	if (report.assistants !== undefined)
		changes.assistants = [...new Set(report.assistants)].sort();
	if (Object.keys(changes).length === 0) return {};
	await withTenantTx(deps.db.app, principal.storageAccountId, (tx) =>
		tx.update(devices).set(changes).where(eq(devices.id, principal.deviceId)),
	);
	return {};
}
