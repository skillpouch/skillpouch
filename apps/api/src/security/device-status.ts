// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Device revocation check on every request (plan 08 §3.3, §6.4). Each API
 * instance caches a device's state for at most one second; `device_revoked`
 * notifications from the listen hub drop the entry immediately.
 */
import { accountMembers, deviceKeys, devices, users, type Database } from '@skillpouch/db';
import { and, eq, isNull } from 'drizzle-orm';
import { withTenantTx } from './tenant-tx';

export interface DeviceStatus {
	state: 'active' | 'suspended' | 'revoked';
	tokenVersion: number;
	userId: string;
	userSuspended: boolean;
	memberId: string | null;
	keys: Map<string, Record<string, string>>;
}

const TTL_MS = 1000;

export class DeviceStatusCache {
	private readonly entries = new Map<string, { status: DeviceStatus | null; expires: number }>();

	constructor(private readonly db: Database) {}

	async get(storageAccountId: string, deviceId: string): Promise<DeviceStatus | null> {
		const cached = this.entries.get(deviceId);
		if (cached && cached.expires > Date.now()) return cached.status;
		const status = await this.load(storageAccountId, deviceId);
		this.entries.set(deviceId, { status, expires: Date.now() + TTL_MS });
		return status;
	}

	invalidate(deviceId: string): void {
		this.entries.delete(deviceId);
	}

	private load(storageAccountId: string, deviceId: string): Promise<DeviceStatus | null> {
		return withTenantTx(this.db, storageAccountId, async (tx) => {
			const [device] = await tx
				.select({
					state: devices.state,
					tokenVersion: devices.tokenVersion,
					userId: devices.userId,
					suspendedAt: users.suspendedAt,
				})
				.from(devices)
				.innerJoin(users, eq(users.id, devices.userId))
				.where(eq(devices.id, deviceId));
			if (!device) return null;
			const keys = await tx
				.select({ jkt: deviceKeys.jkt, jwk: deviceKeys.publicJwk })
				.from(deviceKeys)
				.where(and(eq(deviceKeys.deviceId, deviceId), isNull(deviceKeys.retiredAt)));
			const [member] = await tx
				.select({ id: accountMembers.id })
				.from(accountMembers)
				.where(eq(accountMembers.deviceId, deviceId));
			return {
				state: device.state,
				tokenVersion: device.tokenVersion,
				userId: device.userId,
				userSuspended: device.suspendedAt !== null,
				memberId: member?.id ?? null,
				keys: new Map(keys.map((key) => [key.jkt, key.jwk])),
			};
		});
	}
}
