// SPDX-License-Identifier: AGPL-3.0-only
/** Secret resolution in `loadEnv`: value → `X_FILE` → default secrets directory (production). */
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { REQUIRED_PRODUCTION_SECRETS, loadEnv, secretFileName } from '../../src/config/env';

const PEPPER = 'cHJvZC1wZXBwZXIta2V5LTMyLWJ5dGVzLWxvbmctISE';
const VALUES: Record<string, string> = {
	BETTER_AUTH_SECRET: 'b'.repeat(40),
	DPOP_NONCE_SECRET: 'd'.repeat(40),
	IP_HASH_SECRET: 'i'.repeat(40),
	PEPPER_KEY: PEPPER,
	JWT_SIGNING_KEY: '{"kty":"OKP","crv":"Ed25519","x":"x","d":"d"}',
};

function secretsDir(files: Record<string, string>): string {
	const dir = mkdtempSync(join(tmpdir(), 'sp-secrets-'));
	for (const [key, value] of Object.entries(files)) {
		writeFileSync(join(dir, secretFileName(key)), `${value}\n`);
	}
	return dir;
}

function production(extra: Record<string, string>) {
	return { NODE_ENV: 'production', DATABASE_URL: 'postgres://x/y', ...extra };
}

describe('loadEnv secrets', () => {
	it('production reads every required secret from the default directory', () => {
		const dir = secretsDir(VALUES);
		const env = loadEnv(production({ SECRETS_DIR: dir }));
		expect(env.PEPPER_KEY).toBe(PEPPER);
		expect(env.BETTER_AUTH_SECRET).toBe(VALUES.BETTER_AUTH_SECRET);
		expect(env.JWT_SIGNING_KEY).toBe(VALUES.JWT_SIGNING_KEY);
	});

	it('production lists every missing secret with the file it looked for', () => {
		const dir = secretsDir({ PEPPER_KEY: PEPPER });
		let message = '';
		try {
			loadEnv(production({ SECRETS_DIR: dir }));
		} catch (error) {
			message = (error as Error).message;
		}
		for (const key of REQUIRED_PRODUCTION_SECRETS.filter((k) => k !== 'PEPPER_KEY')) {
			expect(message).toContain(`${key}: missing — create ${join(dir, secretFileName(key))}`);
		}
		expect(message).not.toContain('PEPPER_KEY: missing');
	});

	it('an explicit value or X_FILE wins over the default directory', () => {
		const dir = secretsDir(VALUES);
		const other = secretsDir({ IP_HASH_SECRET: 'f'.repeat(40) });
		const env = loadEnv(
			production({
				SECRETS_DIR: dir,
				BETTER_AUTH_SECRET: 'v'.repeat(40),
				IP_HASH_SECRET_FILE: join(other, 'ip_hash_secret'),
			}),
		);
		expect(env.BETTER_AUTH_SECRET).toBe('v'.repeat(40));
		expect(env.IP_HASH_SECRET).toBe('f'.repeat(40));
	});

	it('a missing or empty X_FILE is a clear error, not a crash', () => {
		const dir = secretsDir({ ...VALUES, DPOP_NONCE_SECRET: '' });
		const load = () =>
			loadEnv(
				production({
					SECRETS_DIR: dir,
					PEPPER_KEY_FILE: '/nonexistent/pepper_key',
					DPOP_NONCE_SECRET_FILE: join(dir, 'dpop_nonce_secret'),
				}),
			);
		expect(load).toThrow('PEPPER_KEY_FILE: /nonexistent/pepper_key does not exist');
		expect(load).toThrow(`DPOP_NONCE_SECRET_FILE: ${join(dir, 'dpop_nonce_secret')} is empty`);
	});

	it('a malformed secret file still fails validation', () => {
		const dir = secretsDir({ ...VALUES, PEPPER_KEY: 'too-short' });
		expect(() => loadEnv(production({ SECRETS_DIR: dir }))).toThrow(/PEPPER_KEY/);
	});

	it('development ignores the secrets directory and uses dev defaults', () => {
		const dir = secretsDir({ PEPPER_KEY: PEPPER });
		const env = loadEnv({ NODE_ENV: 'development', DATABASE_URL: 'x', SECRETS_DIR: dir });
		expect(env.PEPPER_KEY).not.toBe(PEPPER);
	});
});

describe('development defaults never reach a public host', () => {
	const base = { DATABASE_URL: 'postgres://x/y' };

	it('refuses the built-in secrets on a real domain, even without NODE_ENV', () => {
		expect(() => loadEnv({ ...base, API_PUBLIC_URL: 'https://skillpouch.net' })).toThrow(
			/development secrets/,
		);
	});

	it('refuses DEV_LOGIN on a real domain even with real secrets', () => {
		expect(() =>
			loadEnv({
				...base,
				...VALUES,
				NODE_ENV: 'development',
				DEV_LOGIN: 'true',
				API_PUBLIC_URL: 'https://staging.skillpouch.net',
			}),
		).toThrow(/development secrets or DEV_LOGIN/);
	});

	it('allows them on loopback hosts, and real secrets anywhere', () => {
		for (const url of [
			'http://localhost:8080',
			'http://127.0.0.1:18080',
			'http://app.localhost',
		]) {
			expect(loadEnv({ ...base, API_PUBLIC_URL: url }).API_PUBLIC_URL).toBe(url);
		}
		expect(
			loadEnv({ ...base, ...VALUES, API_PUBLIC_URL: 'https://skillpouch.net' }).NODE_ENV,
		).toBe('development');
	});
});

describe('loadEnv blob storage', () => {
	const base = { DATABASE_URL: 'postgres://x/y' };
	const S3 = {
		BLOB_DRIVER: 's3',
		S3_ENDPOINT: 'https://acct.r2.cloudflarestorage.com',
		S3_BUCKET: 'skillpouch-blobs',
		S3_ACCESS_KEY_ID: 'id',
	};

	it('S3 needs an endpoint, bucket and both keys', () => {
		expect(() => loadEnv({ ...base, ...S3 })).toThrow(/BLOB_DRIVER=s3 needs/);
		const env = loadEnv({ ...base, ...S3, S3_SECRET_ACCESS_KEY: 'secret' });
		expect(env.BLOB_DRIVER).toBe('s3');
		expect(env.S3_REGION).toBe('auto');
	});

	it('reads the S3 secret key from the secrets directory in production', () => {
		const dir = secretsDir({ ...VALUES, S3_SECRET_ACCESS_KEY: 'from-file' });
		const env = loadEnv(production({ SECRETS_DIR: dir, ...S3 }));
		expect(env.S3_SECRET_ACCESS_KEY).toBe('from-file');
	});
});
