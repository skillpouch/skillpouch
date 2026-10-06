// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Writes the OpenAPI 3.1 spec to `packages/contracts/generated/openapi.json`
 *: the web app generates its typed client from it, the CLI pins it.
 *
 *   pnpm --filter @skillpouch/api openapi           # regenerate
 *   pnpm --filter @skillpouch/api openapi --check   # CI: fail if out of date
 *
 * The server is built with development defaults and never connects to a
 * database; only the route schemas are read.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import pino from 'pino';
import { loadEnv } from '../src/config/env';
import { closeDeps, createDeps } from '../src/deps';
import { buildServer } from '../src/server';

const OUTPUT = fileURLToPath(
	new URL('../../../packages/contracts/generated/openapi.json', import.meta.url),
);

const env = loadEnv({
	NODE_ENV: 'development',
	DATABASE_URL: 'postgres://openapi@127.0.0.1:1/openapi',
	API_PUBLIC_URL: 'https://skillpouch.net',
	WEB_ORIGIN: 'https://skillpouch.net',
	SWAGGER: 'false',
});
const deps = await createDeps(env, pino({ level: 'silent' }), 'openapi');
const { app } = await buildServer(deps);
await app.ready();
const spec = `${JSON.stringify(app.swagger(), null, '\t')}\n`;
await app.close();
await closeDeps(deps);

if (process.argv.includes('--check')) {
	const current = await readFile(OUTPUT, 'utf8').catch(() => '');
	if (current !== spec) {
		console.error('openapi.json is out of date: run `pnpm openapi` and commit the result.');
		process.exit(1);
	}
	console.log('openapi.json is up to date');
} else {
	await writeFile(OUTPUT, spec);
	console.log(`wrote ${OUTPUT}`);
}
