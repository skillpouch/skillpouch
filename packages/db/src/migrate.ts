// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Migration runner (plan 10 §5.2).
 *
 * - Applies `migrations/*.sql` in file-name order, each in its own transaction
 *   (files whose header contains `-- no-transaction` run outside one, for
 *   `CREATE INDEX CONCURRENTLY`).
 * - One migrator at a time: a Postgres advisory lock.
 * - Short `lock_timeout` so a migration never queues behind long transactions
 *   and blocks traffic; lock timeouts are retried with backoff.
 * - Every applied file is recorded with its checksum; editing an applied file
 *   is an error (write a new migration instead).
 * - Every file must declare `-- phase: expand` or `-- phase: contract`.
 */
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

export const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations');

const ADVISORY_LOCK_KEY = 0x5b1e_9001;
const LOCK_TIMEOUT_SQLSTATE = '55P03';

export interface MigrationFile {
	name: string;
	sql: string;
	checksum: string;
	phase: 'expand' | 'contract';
	transactional: boolean;
}

export interface MigrateOptions {
	connectionString: string;
	migrationsDir?: string;
	log?: (message: string) => void;
	/** Retries per file when `lock_timeout` fires. */
	lockRetries?: number;
}

export function loadMigrations(dir = MIGRATIONS_DIR): MigrationFile[] {
	return readdirSync(dir)
		.filter((file) => file.endsWith('.sql'))
		.sort()
		.map((name) => {
			const sql = readFileSync(join(dir, name), 'utf8');
			const phase = /^-- phase: (expand|contract)\s*$/m.exec(sql)?.[1];
			if (phase !== 'expand' && phase !== 'contract') {
				throw new Error(`${name}: missing "-- phase: expand|contract" header`);
			}
			return {
				name,
				sql,
				phase,
				checksum: createHash('sha256').update(sql).digest('hex'),
				transactional: !/^-- no-transaction\s*$/m.test(sql),
			};
		});
}

/** Applies pending migrations. Returns the names of the files it applied. */
export async function migrate(options: MigrateOptions): Promise<string[]> {
	const log = options.log ?? (() => {});
	const files = loadMigrations(options.migrationsDir);
	const client = new pg.Client({ connectionString: options.connectionString });
	await client.connect();
	const applied: string[] = [];
	try {
		await client.query('SELECT pg_advisory_lock($1)', [ADVISORY_LOCK_KEY]);
		await client.query(`
			CREATE TABLE IF NOT EXISTS schema_migrations (
				name        text PRIMARY KEY,
				checksum    text NOT NULL,
				applied_at  timestamptz NOT NULL DEFAULT now()
			)`);
		const { rows } = await client.query<{ name: string; checksum: string }>(
			'SELECT name, checksum FROM schema_migrations',
		);
		const done = new Map(rows.map((row) => [row.name, row.checksum]));

		for (const file of files) {
			const previous = done.get(file.name);
			if (previous !== undefined) {
				if (previous !== file.checksum) {
					throw new Error(`${file.name} was modified after it was applied`);
				}
				continue;
			}
			await applyWithRetry(client, file, options.lockRetries ?? 5, log);
			applied.push(file.name);
		}
		return applied;
	} finally {
		await client.query('SELECT pg_advisory_unlock($1)', [ADVISORY_LOCK_KEY]).catch(() => {});
		await client.end();
	}
}

async function applyWithRetry(
	client: pg.Client,
	file: MigrationFile,
	retries: number,
	log: (message: string) => void,
): Promise<void> {
	for (let attempt = 0; ; attempt++) {
		try {
			await applyOne(client, file);
			log(`applied ${file.name} (${file.phase})`);
			return;
		} catch (error) {
			const code = (error as { code?: string }).code;
			if (code !== LOCK_TIMEOUT_SQLSTATE || attempt >= retries) throw error;
			const delay = 250 * 2 ** attempt;
			log(`${file.name}: lock timeout, retrying in ${delay} ms`);
			await new Promise((resolve) => setTimeout(resolve, delay));
		}
	}
}

async function applyOne(client: pg.Client, file: MigrationFile): Promise<void> {
	const record = () =>
		client.query('INSERT INTO schema_migrations (name, checksum) VALUES ($1, $2)', [
			file.name,
			file.checksum,
		]);
	if (!file.transactional) {
		await client.query("SET lock_timeout = '3s'; SET statement_timeout = '60s'");
		await client.query(file.sql);
		await record();
		return;
	}
	await client.query('BEGIN');
	try {
		await client.query("SET LOCAL lock_timeout = '3s'; SET LOCAL statement_timeout = '60s'");
		await client.query(file.sql);
		await record();
		await client.query('COMMIT');
	} catch (error) {
		await client.query('ROLLBACK');
		throw error;
	}
}
