// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Publishing side of the listen hub. `pg_notify` inside a transaction is
 * delivered only after COMMIT, so listeners never see uncommitted state.
 */
import { sql } from 'drizzle-orm';
import type { TenantTx } from '../security/tenant-tx';

type Executor = Pick<TenantTx, 'execute'>;

export function notifyPouch(tx: Executor, storageAccountId: string, pouchId: string, seq: number) {
	return tx.execute(
		sql`SELECT pg_notify('pouch_events', ${JSON.stringify({ sa: storageAccountId, p: pouchId, s: seq })})`,
	);
}

export function notifyAccount(
	tx: Executor,
	storageAccountId: string,
	type: string,
	data: Record<string, unknown> = {},
) {
	return tx.execute(
		sql`SELECT pg_notify('account_events', ${JSON.stringify({ sa: storageAccountId, type, data })})`,
	);
}

export function notifyDeviceRevoked(tx: Executor, storageAccountId: string, deviceId: string) {
	return tx.execute(
		sql`SELECT pg_notify('device_revoked', ${JSON.stringify({ sa: storageAccountId, d: deviceId })})`,
	);
}
