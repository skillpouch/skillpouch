// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Environment configuration. Validated with Zod at boot; the
 * process exits on invalid configuration.
 *
 * Secrets are resolved in this order (first hit wins):
 *   1. the variable itself (`PEPPER_KEY=...`),
 *   2. a file named by `X_FILE` (`PEPPER_KEY_FILE=/somewhere/pepper_key`),
 *   3. production only: the default location `$SECRETS_DIR/<x lowercased>`
 *      (`/run/secrets/pepper_key`; `deploy/secrets/` is mounted there).
 * Production refuses to boot while a required secret is missing and lists
 * every missing one with the exact file it looked for.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';

const bool = z
	.enum(['true', 'false', '1', '0'])
	.transform((value) => value === 'true' || value === '1');

const DEV_SECRET = 'dev-only-secret-change-me-dev-only-secret-change-me';
/** 32 zero-ish bytes; only ever used outside production. */
const DEV_PEPPER_KEY = 'ZGV2LW9ubHktcGVwcGVyLWtleS1jaGFuZ2UtbWUtISE';

/** Where the Compose stack mounts `deploy/secrets/` inside the container. */
export const DEFAULT_SECRETS_DIR = '/run/secrets';

const EnvSchema = z
	.object({
		NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
		API_ROLE: z.enum(['api', 'worker', 'migrate']).default('api'),
		HOST: z.string().default('0.0.0.0'),
		PORT: z.coerce.number().int().min(0).max(65535).default(8080),
		LOG_LEVEL: z
			.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
			.default('info'),
		TRUST_PROXY: bool.default(false),

		/** Public origin of the API (DPoP `htu`, OAuth callbacks). */
		API_PUBLIC_URL: z.url().default('http://localhost:8080'),
		/** The web app origin — the only CORS origin. */
		WEB_ORIGIN: z.url().default('http://localhost:5173'),

		DATABASE_URL: z.string().min(1),
		/** Optional per-role login URLs for production. */
		DATABASE_URL_MAINTENANCE: z.string().optional(),
		DATABASE_URL_ADMIN: z.string().optional(),
		MIGRATION_DATABASE_URL: z.string().optional(),
		/** Dev/test: connect as one user and `SET ROLE` per pool so RLS is real. */
		DB_SET_ROLE: bool.optional(),
		DB_POOL_MAX: z.coerce.number().int().min(1).default(20),

		BETTER_AUTH_SECRET: z.string().min(32),
		GITHUB_CLIENT_ID: z.string().optional(),
		GITHUB_CLIENT_SECRET: z.string().optional(),
		GOOGLE_CLIENT_ID: z.string().optional(),
		GOOGLE_CLIENT_SECRET: z.string().optional(),
		/** Comma-separated verified emails promoted to admin on sign-in. */
		ADMIN_EMAILS: z.string().default(''),

		/** Production: directory searched for secrets not set explicitly (see header). */
		SECRETS_DIR: z.string().default(DEFAULT_SECRETS_DIR),

		/** Ed25519 private JWK (JSON) for access tokens; generated per boot in dev/test. */
		JWT_SIGNING_KEY: z.string().optional(),
		DPOP_NONCE_SECRET: z.string().min(32),
		IP_HASH_SECRET: z.string().min(32),
		/**
		 * Seals each account's unlock pepper. 32 bytes, base64url.
		 * Lives only in the secrets directory — never in the DB or its backups.
		 */
		PEPPER_KEY: z.string().regex(/^[A-Za-z0-9_-]{43}$/, 'must be 32 bytes base64url'),
		/** Version label stored next to every sealed pepper (key rotation). */
		PEPPER_KEY_ID: z.string().min(1).max(32).default('k1'),
		/** WebAuthn relying party (passkey unlock); defaults to the web origin's host. */
		WEBAUTHN_RP_ID: z.string().optional(),
		WEBAUTHN_RP_NAME: z.string().default('SkillPouch'),

		BLOB_DRIVER: z.enum(['fs']).default('fs'),
		BLOB_FS_ROOT: z.string().default('./data/blobs'),

		/** Internal Prometheus port (never exposed by the proxy); 0 disables. */
		METRICS_PORT: z.coerce.number().int().min(0).max(65535).default(9464),
		/** pg-boss connection (needs CREATE on its own schema); defaults to the migration URL. */
		JOBS_DATABASE_URL: z.string().optional(),
		/** Graceful shutdown: how long in-flight requests may take to finish. */
		SHUTDOWN_GRACE_MS: z.coerce.number().int().min(0).default(25_000),
		/** Swagger UI at /docs — on by default outside production. */
		SWAGGER: bool.optional(),
		/**
		 * `POST /v1/dev/login`: sign in by email without OAuth, for local
		 * development and browser tests. Refused in production.
		 */
		DEV_LOGIN: bool.default(false),
		RATE_LIMIT_ENABLED: bool.default(true),
		MAINTENANCE_WRITE_PAUSE: bool.default(false),

		POLAR_ACCESS_TOKEN: z.string().optional(),
		POLAR_WEBHOOK_SECRET: z.string().optional(),
		POLAR_SERVER: z.enum(['sandbox', 'production']).default('sandbox'),

		CLI_LATEST_VERSION: z.string().default('0.1.0'),
		CLI_MIN_VERSION: z.string().default('0.1.0'),
	})
	.refine((env) => !(env.DEV_LOGIN && env.NODE_ENV === 'production'), {
		message: 'DEV_LOGIN cannot be enabled in production',
		path: ['DEV_LOGIN'],
	})
	.transform((env) => ({
		...env,
		DB_SET_ROLE: env.DB_SET_ROLE ?? env.NODE_ENV !== 'production',
		SWAGGER: env.SWAGGER ?? env.NODE_ENV !== 'production',
		WEBAUTHN_RP_ID: env.WEBAUTHN_RP_ID ?? new URL(env.WEB_ORIGIN).hostname,
		adminEmails: env.ADMIN_EMAILS.split(',')
			.map((email) => email.trim().toLowerCase())
			.filter(Boolean),
	}));

export type Env = z.infer<typeof EnvSchema>;

const SECRET_KEYS = [
	'DATABASE_URL',
	'DATABASE_URL_MAINTENANCE',
	'DATABASE_URL_ADMIN',
	'MIGRATION_DATABASE_URL',
	'JOBS_DATABASE_URL',
	'BETTER_AUTH_SECRET',
	'GITHUB_CLIENT_SECRET',
	'GOOGLE_CLIENT_SECRET',
	'JWT_SIGNING_KEY',
	'DPOP_NONCE_SECRET',
	'IP_HASH_SECRET',
	'PEPPER_KEY',
	'POLAR_ACCESS_TOKEN',
	'POLAR_WEBHOOK_SECRET',
] as const;

/** Secrets production cannot run without (the rest enable optional features). */
export const REQUIRED_PRODUCTION_SECRETS = [
	'BETTER_AUTH_SECRET',
	'DPOP_NONCE_SECRET',
	'IP_HASH_SECRET',
	'PEPPER_KEY',
	'JWT_SIGNING_KEY',
] as const satisfies readonly (typeof SECRET_KEYS)[number][];

/** `PEPPER_KEY` → `pepper_key`: the file name used in the secrets directory. */
export function secretFileName(key: string): string {
	return key.toLowerCase();
}

function readSecretFile(path: string): string | undefined {
	const value = readFileSync(path, 'utf8').trim();
	return value === '' ? undefined : value;
}

/** Resolves secrets (header order) and fills dev-only defaults outside production. */
function resolveRaw(source: NodeJS.ProcessEnv): Record<string, string | undefined> {
	const raw: Record<string, string | undefined> = { ...source };
	const production = raw.NODE_ENV === 'production';
	const secretsDir = raw.SECRETS_DIR || DEFAULT_SECRETS_DIR;
	const problems: string[] = [];

	for (const key of SECRET_KEYS) {
		if (raw[key]) continue;
		const explicitFile = raw[`${key}_FILE`];
		if (explicitFile) {
			if (!existsSync(explicitFile)) {
				problems.push(`  ${key}_FILE: ${explicitFile} does not exist`);
				continue;
			}
			raw[key] = readSecretFile(explicitFile);
			if (!raw[key]) problems.push(`  ${key}_FILE: ${explicitFile} is empty`);
			continue;
		}
		if (!production) continue;
		const defaultFile = join(secretsDir, secretFileName(key));
		if (existsSync(defaultFile)) raw[key] = readSecretFile(defaultFile);
	}

	if (production) {
		for (const key of REQUIRED_PRODUCTION_SECRETS) {
			if (raw[key] || raw[`${key}_FILE`]) continue;
			problems.push(
				`  ${key}: missing — create ${join(secretsDir, secretFileName(key))} or set ${key} / ${key}_FILE`,
			);
		}
	}
	if (problems.length > 0) throw new Error(`Invalid environment:\n${problems.join('\n')}`);

	if (!production) {
		for (const key of ['BETTER_AUTH_SECRET', 'DPOP_NONCE_SECRET', 'IP_HASH_SECRET'] as const) {
			raw[key] ??= DEV_SECRET;
		}
		raw.PEPPER_KEY ??= DEV_PEPPER_KEY;
	}
	return raw;
}

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
	const parsed = EnvSchema.safeParse(resolveRaw(source));
	if (!parsed.success) {
		const problems = parsed.error.issues.map(
			(issue) => `  ${issue.path.join('.')}: ${issue.message}`,
		);
		throw new Error(`Invalid environment:\n${problems.join('\n')}`);
	}
	return parsed.data;
}
