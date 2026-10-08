// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The API side of the end-to-end tests: a freshly migrated database (cloned
 * from the test template) and the real API process with dev sign-in enabled.
 * Playwright starts this as a web server and stops it with SIGTERM; the
 * database is dropped on the way out.
 *
 *   E2E_API_PORT  (default 18080)   E2E_WEB_PORT (default 15173)
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createTestDatabase } from '@skillpouch/db/testing';
import pg from 'pg';

const apiPort = process.env.E2E_API_PORT ?? '18080';
const webOrigin = `http://localhost:${process.env.E2E_WEB_PORT ?? '15173'}`;
const apiDir = resolve(import.meta.dirname, '../../api');

const database = await createTestDatabase();
// A hidden plan, the kind only an admin gives out.
const seed = new pg.Client({ connectionString: database.url });
await seed.connect();
await seed.query(`
	INSERT INTO plans (slug, name, price_cents, pouch_limit, storage_bytes, is_public, sort)
	VALUES ('friends-pass', 'Friends Pass', 0, 10, 5368709120, false, 90)`);
await seed.end();
const blobRoot = mkdtempSync(join(tmpdir(), 'sp-e2e-blobs-'));

const api = spawn(process.execPath, ['--import', 'tsx', 'src/main.ts'], {
	cwd: apiDir,
	stdio: 'inherit',
	env: {
		...process.env,
		NODE_ENV: 'development',
		API_ROLE: 'api',
		HOST: '127.0.0.1',
		PORT: apiPort,
		DATABASE_URL: database.url,
		API_PUBLIC_URL: webOrigin,
		WEB_ORIGIN: webOrigin,
		DEV_LOGIN: 'true',
		BLOB_FS_ROOT: blobRoot,
		METRICS_PORT: '0',
		RATE_LIMIT_ENABLED: 'false',
		LOG_LEVEL: process.env.E2E_API_LOG_LEVEL ?? 'warn',
		ADMIN_EMAILS: '',
	},
});

let stopping = false;
async function stop(code: number) {
	if (stopping) return;
	stopping = true;
	api.kill('SIGTERM');
	await new Promise((done) => api.once('exit', done));
	await database.drop().catch(() => undefined);
	rmSync(blobRoot, { recursive: true, force: true });
	process.exit(code);
}

api.once('exit', (code) => void stop(code ?? 1));
process.on('SIGTERM', () => void stop(0));
process.on('SIGINT', () => void stop(0));
