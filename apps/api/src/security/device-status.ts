// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Device revocation check on every request. Each API
 * instance caches a device's state for at most one second; `device_revoked`
 * notifications from the listen hub drop the entry immediately.
 */
import type { Database } from '@skillpouch/db';
import { sql } from 'drizzle-orm';
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
/** Expired entries are swept once the map holds this many (it would grow with every device otherwise). */
const PRUNE_AT = 10_000;

export class DeviceStatusCache {
	private readonly entries = new Map<string, { status: DeviceStatus | null; expires: number }>();

	constructor(private readonly db: Database) {}

	async get(storageAccountId: string, deviceId: string): Promise<DeviceStatus | null> {
		const cached = this.entries.get(deviceId);
		if (cached && cached.expires > Date.now()) return cached.status;
		const status = await this.load(storageAccountId, deviceId);
		if (this.entries.size >= PRUNE_AT) this.prune();
		this.entries.set(deviceId, { status, expires: Date.now() + TTL_MS });
		return status;
	}

	private prune(): void {
		const now = Date.now();
		for (const [deviceId, entry] of this.entries) {
			if (entry.expires <= now) this.entries.delete(deviceId);
		}
	}

	invalidate(deviceId: string): void {
		this.entries.delete(deviceId);
	}

	/** Drops every cached entry of this instance (e.g. after an admin suspends a user). */
	invalidateAll(): void {
		this.entries.clear();
	}

	/** One round trip: the device, its user, its roster member and its active keys. */
	private load(storageAccountId: string, deviceId: string): Promise<DeviceStatus | null> {
		return withTenantTx(this.db, storageAccountId, async (tx) => {
			const result = await tx.execute<{
				state: DeviceStatus['state'];
				token_version: number;
				user_id: string;
				suspended: boolean;
				member_id: string | null;
				keys: { jkt: string; jwk: Record<string, string> }[];
			}>(sql`
				SELECT d.state, d.token_version, d.user_id, u.suspended_at IS NOT NULL AS suspended,
					(SELECT m.id FROM account_members m WHERE m.device_id = d.id) AS member_id,
					COALESCE((
						SELECT json_agg(json_build_object('jkt', k.jkt, 'jwk', k.public_jwk))
						FROM device_keys k
						WHERE k.storage_account_id = d.storage_account_id
							AND k.device_id = d.id AND k.retired_at IS NULL
					), '[]'::json) AS keys
				FROM devices d JOIN users u ON u.id = d.user_id
				WHERE d.id = ${deviceId}`);
			const [device] = result.rows;
			if (!device) return null;
			return {
				state: device.state,
				tokenVersion: device.token_version,
				userId: device.user_id,
				userSuspended: device.suspended,
				memberId: device.member_id,
				keys: new Map(device.keys.map((key) => [key.jkt, key.jwk])),
			};
		});
	}
}
