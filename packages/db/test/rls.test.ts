// SPDX-License-Identifier: AGPL-3.0-only
/** Row-level security behaviour as the app role (08 §4.2, 11 §4). */
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPool } from '../src/connection';
import { createTestDatabase, type TestDatabase } from '../src/testing';

describe('row-level security', () => {
	let db: TestDatabase;
	let owner: pg.Client;
	let app: pg.Pool;
	const accountA = randomUUID();
	const accountB = randomUUID();

	beforeAll(async () => {
		db = await createTestDatabase();
		owner = new pg.Client({ connectionString: db.url });
		await owner.connect();
		for (const [user, account] of [
			['user-a', accountA],
			['user-b', accountB],
		] as const) {
			await owner.query(
				`INSERT INTO users (id, name, email) VALUES ($1, $1, $1 || '@t.dev')`,
				[user],
			);
			await owner.query(
				`INSERT INTO storage_accounts (id, owner_user_id, entitlements, quota_bytes) VALUES ($1, $2, '{}', 1)`,
				[account, user],
			);
			await owner.query(
				`INSERT INTO pouches (id, storage_account_id, created_seq, epoch) VALUES ($1, $2, 1, $1)`,
				[randomUUID(), account],
			);
		}
		app = createPool({ connectionString: db.url, role: 'sp_app', max: 2 });
	});
	afterAll(async () => {
		await app.end();
		await owner.end();
		await db.drop();
	});

	async function asTenant<T extends pg.QueryResultRow>(
		sa: string | null,
		sql: string,
		params: unknown[] = [],
	) {
		const client = await app.connect();
		try {
			await client.query('BEGIN');
			if (sa) await client.query(`SELECT set_config('app.sa_id', $1, true)`, [sa]);
			const result = await client.query<T>(sql, params);
			await client.query('COMMIT');
			return result.rows;
		} catch (error) {
			await client.query('ROLLBACK');
			throw error;
		} finally {
			client.release();
		}
	}

	it('fails closed without tenant context', async () => {
		await expect(asTenant(null, 'SELECT * FROM pouches')).rejects.toThrow();
	});

	it('only shows rows of the current tenant', async () => {
		const rows = await asTenant<{ storage_account_id: string }>(
			accountA,
			'SELECT storage_account_id FROM pouches',
		);
		expect(rows).toHaveLength(1);
		expect(rows[0]!.storage_account_id).toBe(accountA);
	});

	it('rejects writes into another tenant', async () => {
		await expect(
			asTenant(
				accountA,
				`INSERT INTO pouches (id, storage_account_id, created_seq, epoch) VALUES ($1, $2, 2, $1)`,
				[randomUUID(), accountB],
			),
		).rejects.toThrow(/row-level security/);
	});

	it('cannot update or delete another tenant’s rows', async () => {
		const updated = await asTenant(
			accountA,
			`UPDATE pouches SET state = 'archived' WHERE storage_account_id = $1 RETURNING id`,
			[accountB],
		);
		expect(updated).toHaveLength(0);
	});

	it('does not leak tenant context to the next transaction on the same connection', async () => {
		await asTenant(accountA, 'SELECT 1');
		await expect(asTenant(null, 'SELECT * FROM pouches')).rejects.toThrow();
	});

	it('blocks cross-tenant references at the schema level (composite FKs)', async () => {
		const [pouchB] = await asTenant<{ id: string }>(accountB, 'SELECT id FROM pouches');
		await expect(
			owner.query(
				`INSERT INTO artifacts (id, storage_account_id, pouch_id, name_index) VALUES ($1, $2, $3, '\\x00')`,
				[randomUUID(), accountA, pouchB!.id],
			),
		).rejects.toThrow(/foreign key/);
	});

	it('keeps audit_log append-only for the app role', async () => {
		await expect(asTenant(accountA, 'DELETE FROM audit_log')).rejects.toThrow(
			/permission denied/,
		);
	});
});
