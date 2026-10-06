// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Tenant isolation catalog checks. These run against the
 * live catalog, so a new tenant table without RLS or with a non-composite
 * foreign key fails CI.
 */
import { getTableConfig, type PgTable } from 'drizzle-orm/pg-core';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as schema from '../src/schema/index';
import { createTestDatabase, type TestDatabase } from '../src/testing';

const PRE_TENANT_TABLES = new Set(['cli_auth_requests', 'cli_connect_tokens']);

describe('database catalog', () => {
	let db: TestDatabase;
	let client: pg.Client;

	beforeAll(async () => {
		db = await createTestDatabase();
		client = new pg.Client({ connectionString: db.url });
		await client.connect();
	});
	afterAll(async () => {
		await client.end();
		await db.drop();
	});

	async function tenantTables(): Promise<string[]> {
		const { rows } = await client.query<{ table_name: string }>(`
			SELECT c.table_name FROM information_schema.columns c
			JOIN information_schema.tables t USING (table_schema, table_name)
			WHERE c.table_schema = 'public' AND c.column_name = 'storage_account_id'
				AND t.table_type = 'BASE TABLE'`);
		return rows.map((row) => row.table_name).filter((name) => !PRE_TENANT_TABLES.has(name));
	}

	it('enables and forces RLS with the tenant policy on every tenant table', async () => {
		const tables = await tenantTables();
		expect(tables.length).toBeGreaterThan(15);
		const { rows } = await client.query<{
			relname: string;
			relrowsecurity: boolean;
			relforcerowsecurity: boolean;
			policies: number;
		}>(
			`SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity,
				(SELECT count(*)::int FROM pg_policies p WHERE p.tablename = c.relname AND p.policyname = 'tenant_isolation') AS policies
			FROM pg_class c WHERE c.relname = ANY($1)`,
			[tables],
		);
		for (const row of rows) {
			expect(row, row.relname).toMatchObject({
				relrowsecurity: true,
				relforcerowsecurity: true,
				policies: 1,
			});
		}
	});

	it('uses composite (storage_account_id, …) foreign keys between tenant tables', async () => {
		const tenant = new Set(await tenantTables());
		const { rows } = await client.query<{ src: string; dst: string; cols: string[] }>(`
			SELECT conrelid::regclass::text AS src, confrelid::regclass::text AS dst,
				array(SELECT attname FROM pg_attribute WHERE attrelid = conrelid AND attnum = ANY(conkey))::text[] AS cols
			FROM pg_constraint WHERE contype = 'f'`);
		const tenantToTenant = rows.filter((row) => tenant.has(row.src) && tenant.has(row.dst));
		expect(tenantToTenant.length).toBeGreaterThan(10);
		for (const row of tenantToTenant) {
			expect(row.cols, `${row.src} -> ${row.dst}`).toContain('storage_account_id');
		}
	});

	it('matches the Drizzle schema exactly (no drift)', async () => {
		const { rows } = await client.query<{ table_name: string; column_name: string }>(`
			SELECT table_name, column_name FROM information_schema.columns
			WHERE table_schema = 'public' AND table_name <> 'schema_migrations'`);
		const database = new Map<string, Set<string>>();
		for (const row of rows) {
			if (!database.has(row.table_name)) database.set(row.table_name, new Set());
			database.get(row.table_name)!.add(row.column_name);
		}
		const drizzleTables = (Object.values(schema) as unknown[]).filter(
			(value): value is PgTable =>
				typeof value === 'object' && value !== null && Symbol.for('drizzle:Name') in value,
		);
		const seen = new Set<string>();
		for (const table of drizzleTables) {
			const config = getTableConfig(table);
			seen.add(config.name);
			expect([...(database.get(config.name) ?? [])].sort(), config.name).toEqual(
				config.columns.map((column) => column.name).sort(),
			);
		}
		expect([...database.keys()].sort()).toEqual([...seen].sort());
	});
});
