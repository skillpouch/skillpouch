// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Environment configuration (plan 06 §8). Validated with Zod at boot; the
 * process exits on invalid configuration. Every secret `X` may instead be
 * provided as a file path in `X_FILE` (Docker secrets).
 */
import { readFileSync } from 'node:fs';
import { z } from 'zod';

const bool = z
	.enum(['true', 'false', '1', '0'])
	.transform((value) => value === 'true' || value === '1');

const DEV_SECRET = 'dev-only-secret-change-me-dev-only-secret-change-me';

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
		/** The web app origin — the only CORS origin (17 §1). */
		WEB_ORIGIN: z.url().default('http://localhost:5173'),

		DATABASE_URL: z.string().min(1),
		/** Optional per-role login URLs for production (08 §4.2). */
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
		/** Comma-separated verified emails promoted to admin on sign-in (18 §1). */
		ADMIN_EMAILS: z.string().default(''),

		/** Ed25519 private JWK (JSON) for access tokens; generated per boot in dev/test. */
		JWT_SIGNING_KEY: z.string().optional(),
		DPOP_NONCE_SECRET: z.string().min(32),
		IP_HASH_SECRET: z.string().min(32),

		BLOB_DRIVER: z.enum(['fs']).default('fs'),
		BLOB_FS_ROOT: z.string().default('./data/blobs'),

		/** Swagger UI at /docs — on by default outside production. */
		SWAGGER: bool.optional(),
		RATE_LIMIT_ENABLED: bool.default(true),
		MAINTENANCE_WRITE_PAUSE: bool.default(false),

		POLAR_ACCESS_TOKEN: z.string().optional(),
		POLAR_WEBHOOK_SECRET: z.string().optional(),
		POLAR_SERVER: z.enum(['sandbox', 'production']).default('sandbox'),

		CLI_LATEST_VERSION: z.string().default('0.1.0'),
		CLI_MIN_VERSION: z.string().default('0.1.0'),
	})
	.transform((env) => ({
		...env,
		DB_SET_ROLE: env.DB_SET_ROLE ?? env.NODE_ENV !== 'production',
		SWAGGER: env.SWAGGER ?? env.NODE_ENV !== 'production',
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
	'BETTER_AUTH_SECRET',
	'GITHUB_CLIENT_SECRET',
	'GOOGLE_CLIENT_SECRET',
	'JWT_SIGNING_KEY',
	'DPOP_NONCE_SECRET',
	'IP_HASH_SECRET',
	'POLAR_ACCESS_TOKEN',
	'POLAR_WEBHOOK_SECRET',
] as const;

/** Reads `X_FILE` secrets and fills dev-only defaults outside production. */
function resolveRaw(source: NodeJS.ProcessEnv): Record<string, string | undefined> {
	const raw: Record<string, string | undefined> = { ...source };
	for (const key of SECRET_KEYS) {
		const file = raw[`${key}_FILE`];
		if (!raw[key] && file) raw[key] = readFileSync(file, 'utf8').trim();
	}
	if (raw.NODE_ENV !== 'production') {
		for (const key of ['BETTER_AUTH_SECRET', 'DPOP_NONCE_SECRET', 'IP_HASH_SECRET'] as const) {
			raw[key] ??= DEV_SECRET;
		}
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
	if (parsed.data.NODE_ENV === 'production' && !parsed.data.JWT_SIGNING_KEY) {
		throw new Error('Invalid environment:\n  JWT_SIGNING_KEY is required in production');
	}
	return parsed.data;
}
