// SPDX-License-Identifier: AGPL-3.0-only
import { cpSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MIGRATIONS_DIR, loadMigrations, migrate } from '../src/migrate';
import { createEmptyDatabase, type TestDatabase } from '../src/testing';

describe('migration runner (10 §5.2)', () => {
	let db: TestDatabase;

	beforeAll(async () => {
		db = await createEmptyDatabase();
	});
	afterAll(async () => {
		await db.drop();
	});

	it('every migration declares its phase', () => {
		for (const file of loadMigrations()) expect(['expand', 'contract']).toContain(file.phase);
	});

	it('applies all migrations to an empty database, then is a no-op', async () => {
		const first = await migrate({ connectionString: db.url });
		expect(first).toEqual(loadMigrations().map((file) => file.name));
		expect(await migrate({ connectionString: db.url })).toEqual([]);
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
