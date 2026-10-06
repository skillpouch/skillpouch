// SPDX-License-Identifier: AGPL-3.0-only
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema/index';

/** The runtime database roles. */
export type DbRole = 'sp_app' | 'sp_worker' | 'sp_maintenance' | 'sp_admin';

export type Database = NodePgDatabase<typeof schema>;

export interface PoolOptions {
	connectionString: string;
	/**
	 * When set, every connection runs `SET ROLE <role>` first. Production login
	 * users are already members of exactly one role, so this is mainly how dev
	 * and tests (which connect as the owner) still exercise RLS for real.
	 */
	role?: DbRole;
	max?: number;
	applicationName?: string;
}

export function createPool(options: PoolOptions): pg.Pool {
	const pool = new pg.Pool({
		connectionString: options.connectionString,
		max: options.max ?? 10,
		application_name: options.applicationName ?? 'skillpouch',
	});
	if (options.role) {
		const role = options.role;
		pool.on('connect', (client) => {
			// Queries on a pg client run in order, so this precedes any app query.
			client.query(`SET ROLE ${role}`).catch(() => client.end());
		});
	}
	return pool;
}

export function createDatabase(pool: pg.Pool): Database {
	return drizzle(pool, { schema });
}

export { schema };
