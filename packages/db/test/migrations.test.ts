// SPDX-License-Identifier: AGPL-3.0-only
import { cpSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MIGRATIONS_DIR, loadMigrations, migrate, splitStatements } from '../src/migrate';
import { createEmptyDatabase, type TestDatabase } from '../src/testing';

describe('migration runner', () => {
	let db: TestDatabase;

	beforeAll(async () => {
		db = await createEmptyDatabase();
	});
	afterAll(async () => {
		await db.drop();
	});

	it('splits no-transaction files into single statements (comments ignored)', () => {
		expect(
			splitStatements(
				'-- phase: expand\n-- no-transaction\n-- why\nCREATE INDEX CONCURRENTLY a ON t (x);\n\nCREATE INDEX CONCURRENTLY b\n\tON t (y) WHERE y > 0; -- trailing\n',
			),
		).toEqual([
			'-- phase: expand\n-- no-transaction\n-- why\nCREATE INDEX CONCURRENTLY a ON t (x)',
			'CREATE INDEX CONCURRENTLY b\n\tON t (y) WHERE y > 0',
		]);
	});

	it('every migration declares its phase', () => {
		for (const file of loadMigrations()) expect(['expand', 'contract']).toContain(file.phase);
	});

	it('applies all migrations to an empty database, then is a no-op', async () => {
		const first = await migrate({ connectionString: db.url });
		expect(first).toEqual(loadMigrations().map((file) => file.name));
		expect(await migrate({ connectionString: db.url })).toEqual([]);
	});

	it('builds the concurrent indexes completely (none left invalid)', async () => {
		const client = new pg.Client({ connectionString: db.url });
		await client.connect();
		try {
			const { rows } = await client.query(
				`SELECT c.relname, i.indisvalid FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
				 WHERE c.relname IN ('artifacts_head_revision_idx', 'audit_log_created_idx', 'device_cursors_pouch_idx')`,
			);
			expect(rows).toHaveLength(3);
			expect(rows.every((row) => row.indisvalid)).toBe(true);
		} finally {
			await client.end();
		}
	});

	it('refuses to run when an applied migration was edited', async () => {
		const dir = mkdtempSync(join(tmpdir(), 'sp-migrations-'));
		cpSync(MIGRATIONS_DIR, dir, { recursive: true });
		const [first] = loadMigrations(dir);
		writeFileSync(join(dir, first!.name), `${first!.sql}\n-- edited\n`);
		await expect(migrate({ connectionString: db.url, migrationsDir: dir })).rejects.toThrow(
			/modified after it was applied/,
		);
	});

	it('rejects files without a phase header', () => {
		const dir = mkdtempSync(join(tmpdir(), 'sp-migrations-'));
		writeFileSync(join(dir, '0001_bad.sql'), 'SELECT 1;');
		expect(() => loadMigrations(dir)).toThrow(/phase/);
	});

	it('seeds exactly one default plan', async () => {
		const client = new pg.Client({ connectionString: db.url });
		await client.connect();
		const { rows } = await client.query('SELECT slug FROM plans WHERE is_default');
		await client.end();
		expect(rows).toEqual([{ slug: 'free' }]);
	});
});
