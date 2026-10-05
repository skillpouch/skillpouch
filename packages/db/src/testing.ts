// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Test helpers: every test file gets its own freshly migrated database,
 * cloned from a template so it takes milliseconds instead of re-running the
 * migrations. Requires TEST_DATABASE_URL pointing at a Postgres superuser
 * (CI service container or `docker compose -f deploy/compose.dev.yaml up`).
 */
import { createHash, randomBytes } from 'node:crypto';
import pg from 'pg';
import { loadMigrations, migrate } from './migrate';

export const DEFAULT_TEST_DATABASE_URL = 'postgres://postgres:postgres@localhost:55432/postgres';

export function testAdminUrl(): string {
	return process.env.TEST_DATABASE_URL ?? DEFAULT_TEST_DATABASE_URL;
}

function withDatabase(url: string, database: string): string {
	const parsed = new URL(url);
	parsed.pathname = `/${database}`;
	return parsed.toString();
}

async function adminQuery<T>(url: string, fn: (client: pg.Client) => Promise<T>): Promise<T> {
	const client = new pg.Client({ connectionString: url });
	await client.connect();
	try {
		return await fn(client);
	} finally {
		await client.end();
	}
}

/** Name of the template for the current set of migrations. */
function templateName(): string {
	const hash = createHash('sha256');
	for (const file of loadMigrations()) hash.update(file.checksum);
	return `sp_template_${hash.digest('hex').slice(0, 12)}`;
}

/** Creates (once) the migrated template database and returns its name. */
export async function ensureTemplate(adminUrl = testAdminUrl()): Promise<string> {
	const name = templateName();
	await adminQuery(adminUrl, async (client) => {
		await client.query('SELECT pg_advisory_lock(424242)');
		try {
			const exists = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [
				name,
			]);
			if (exists.rowCount === 0) {
				const building = `${name}_building`;
				await client.query(`DROP DATABASE IF EXISTS ${building}`);
				await client.query(`CREATE DATABASE ${building}`);
				await migrate({ connectionString: withDatabase(adminUrl, building) });
				await client.query(`ALTER DATABASE ${building} RENAME TO ${name}`);
			}
		} finally {
			await client.query('SELECT pg_advisory_unlock(424242)');
		}
	});
	return name;
}

export interface TestDatabase {
	/** Connection string (owner/superuser) of the new database. */
	url: string;
	name: string;
	drop(): Promise<void>;
}

/** A fresh, fully migrated, empty database for one test file. */
export async function createTestDatabase(adminUrl = testAdminUrl()): Promise<TestDatabase> {
	const template = await ensureTemplate(adminUrl);
	const name = `sp_test_${randomBytes(6).toString('hex')}`;
	await adminQuery(adminUrl, (client) =>
		client.query(`CREATE DATABASE ${name} TEMPLATE ${template}`),
	);
	return {
		url: withDatabase(adminUrl, name),
		name,
		drop: () =>
			adminQuery(adminUrl, async (client) => {
				await client.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
			}),
	};
}

/** Creates an empty database (no migrations) — used by the migration tests. */
export async function createEmptyDatabase(adminUrl = testAdminUrl()): Promise<TestDatabase> {
	const name = `sp_empty_${randomBytes(6).toString('hex')}`;
	await adminQuery(adminUrl, (client) => client.query(`CREATE DATABASE ${name}`));
	return {
		url: withDatabase(adminUrl, name),
		name,
		drop: () =>
			adminQuery(adminUrl, async (client) => {
				await client.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
			}),
	};
}
