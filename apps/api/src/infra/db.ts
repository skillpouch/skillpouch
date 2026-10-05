// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Database pools, one per role (plan 06 §2.1, 08 §4.2):
 *   app          — API requests (RLS enforced, tenant via withTenantTx)
 *   maintenance  — cross-tenant worker jobs (BYPASSRLS, fixed SQL only)
 *   admin        — /v1/admin routes (metadata grants only)
 */
import { createDatabase, createPool, type Database } from '@skillpouch/db';
import type pg from 'pg';
import type { Env } from '../config/env';

export interface Databases {
	app: Database;
	maintenance: Database;
	admin: Database;
	pools: pg.Pool[];
	close(): Promise<void>;
}

export function createDatabases(env: Env, applicationName: string): Databases {
	const role = <R extends 'sp_app' | 'sp_maintenance' | 'sp_admin'>(r: R) =>
		env.DB_SET_ROLE ? { role: r } : {};
	const appPool = createPool({
		connectionString: env.DATABASE_URL,
		max: env.DB_POOL_MAX,
		applicationName,
		...role('sp_app'),
	});
	const maintenancePool = createPool({
		connectionString: env.DATABASE_URL_MAINTENANCE ?? env.DATABASE_URL,
		max: 4,
		applicationName: `${applicationName}-maintenance`,
		...role('sp_maintenance'),
	});
	const adminPool = createPool({
		connectionString: env.DATABASE_URL_ADMIN ?? env.DATABASE_URL,
		max: 4,
		applicationName: `${applicationName}-admin`,
		...role('sp_admin'),
	});
	const pools = [appPool, maintenancePool, adminPool];
	return {
		app: createDatabase(appPool),
		maintenance: createDatabase(maintenancePool),
		admin: createDatabase(adminPool),
		pools,
		close: async () => {
			await Promise.all(pools.map((pool) => pool.end()));
		},
	};
}
