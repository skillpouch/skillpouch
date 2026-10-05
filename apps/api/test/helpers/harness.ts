// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Test harness: a fresh migrated database per test file and the real server
 * built with `buildServer`, so tests exercise production wiring (RLS roles,
 * hooks, envelope, auth). Requests go through `app.inject` or, for e2e
 * tests, through a real listening socket.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTestDatabase, type TestDatabase } from '@skillpouch/db/testing';
import pg from 'pg';
import pino from 'pino';
import { loadEnv, type Env } from '../../src/config/env';
import { closeDeps, createDeps, type Deps } from '../../src/deps';
import { buildServer } from '../../src/server';
import type { ZodApp } from '../../src/http/zod-app';

export const API_URL = 'http://localhost:8080';
export const WEB_ORIGIN = 'http://localhost:5173';

export interface Harness {
	app: ZodApp;
	deps: Deps;
	env: Env;
	database: TestDatabase;
	/** Superuser connection for assertions and fixtures (bypasses RLS). */
	owner: pg.Pool;
	blobRoot: string;
	close(): Promise<void>;
}

export async function createHarness(overrides: Record<string, string> = {}): Promise<Harness> {
	const database = await createTestDatabase();
	const blobRoot = mkdtempSync(join(tmpdir(), 'sp-blobs-'));
	const env = loadEnv({
		NODE_ENV: 'test',
		DATABASE_URL: database.url,
		API_PUBLIC_URL: API_URL,
		WEB_ORIGIN,
		BLOB_FS_ROOT: blobRoot,
		LOG_LEVEL: 'silent',
		RATE_LIMIT_ENABLED: 'false',
		ADMIN_EMAILS: 'admin@skillpouch.test',
		...overrides,
	});
	const log = pino({ level: process.env.TEST_LOG_LEVEL ?? 'silent' });
	const deps = await createDeps(env, log, 'test');
	await deps.hub.start();
	const { app } = await buildServer(deps);
	await app.ready();
	const owner = new pg.Pool({ connectionString: database.url, max: 2 });
	return {
		app,
		deps,
		env,
		database,
		owner,
		blobRoot,
		close: async () => {
			await app.close();
			await closeDeps(deps);
			await owner.end();
			await database.drop();
			rmSync(blobRoot, { recursive: true, force: true });
		},
	};
}
