// SPDX-License-Identifier: AGPL-3.0-only
/** Closing the pools leaves no connection behind (a later DROP DATABASE … FORCE would kill it). */
import { createTestDatabase, type TestDatabase } from '@skillpouch/db/testing';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadEnv } from '../../src/config/env';
import { createDatabases } from '../../src/infra/db';

describe('database pools', () => {
	let database: TestDatabase;
	beforeAll(async () => {
		database = await createTestDatabase();
	});
	afterAll(async () => {
		await database.drop();
	});

	it('are fully disconnected when close() resolves', async () => {
		const env = loadEnv({
			NODE_ENV: 'test',
			DATABASE_URL: database.url,
			API_PUBLIC_URL: 'http://localhost:8080',
			WEB_ORIGIN: 'http://localhost:5173',
			LOG_LEVEL: 'silent',
		});
		const databases = createDatabases(env, 'sp-close-test');
		let opened = 0;
		let ended = 0;
		for (const pool of databases.pools) {
			pool.on('connect', () => (opened += 1));
			// Emitted once the client's connection has actually closed.
			pool.on('remove', () => (ended += 1));
		}
		// Several clients per pool, all idle by the time close() runs.
		await Promise.all(
			databases.pools.flatMap((pool) =>
				[1, 2, 3].map(() => pool.query('SELECT pg_sleep(0.05)')),
			),
		);
		await databases.close();
		expect(opened).toBeGreaterThanOrEqual(databases.pools.length);
		expect(ended).toBe(opened);

		const observer = new pg.Client({ connectionString: database.url });
		await observer.connect();
		try {
			const { rows } = await observer.query<{ count: string }>(
				`SELECT count(*) FROM pg_stat_activity
				 WHERE datname = current_database() AND application_name LIKE 'sp-close-test%'`,
			);
			expect(Number(rows[0]!.count)).toBe(0);
		} finally {
			await observer.end();
		}
	});
});
