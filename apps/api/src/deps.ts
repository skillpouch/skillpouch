// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The dependency container: one plain object built in `main.ts`
 * (or by tests) and passed explicitly to routes and services. No DI framework,
 * no module-level singletons.
 */
import type pino from 'pino';
import type { Env } from './config/env';
import type { BlobStore } from './infra/blob-store/blob-store';
import { FsBlobStore } from './infra/blob-store/fs-blob-store';
import { S3BlobStore } from './infra/blob-store/s3-blob-store';
import { createDatabases, type Databases } from './infra/db';
import { ListenHub } from './infra/listen-hub';
import { SettingsCache } from './infra/settings';
import { createAuth, type Auth } from './modules/auth/better-auth';
import { PolarProvider } from './modules/billing/polar';
import type { BillingProvider } from './modules/billing/provider';
import { GithubImporter } from './modules/import/github.service';
import { GithubApp } from './modules/marketplaces/github-app';
import { McpRegistryClient } from './modules/marketplaces/mcp-registry';
import { McpRegistryIndex } from './modules/marketplaces/mcp-registry-index';
import { SkillsShClient } from './modules/marketplaces/skills-sh';
import { CliReleases } from './modules/account/cli-release';
import { AccessTokens } from './security/access-token';
import { DeviceStatusCache } from './security/device-status';
import { NonceService } from './security/nonce';
import { PepperBox } from './security/pepper';

export interface Deps {
	env: Env;
	log: pino.Logger;
	db: Databases;
	auth: Auth;
	tokens: AccessTokens;
	nonces: NonceService;
	/** Seals/opens per-account unlock peppers with the off-DB PEPPER_KEY. */
	pepper: PepperBox;
	blobs: BlobStore;
	hub: ListenHub;
	deviceStatus: DeviceStatusCache;
	settings: SettingsCache;
	/** Null when no billing provider is configured (self-hosting, dev): billing routes answer `billing_unavailable`. */
	billing: BillingProvider | null;
	/** GitHub repository reader; tests swap its fetch. */
	github: GithubImporter;
	/** Null unless the GitHub App is configured: private-repo marketplaces are off. */
	githubApp: GithubApp | null;
	skillsSh: SkillsShClient;
	/** The newest CLI on npm; tests swap its fetch. */
	cliReleases: CliReleases;
	mcpRegistry: McpRegistryClient;
	/** Searchable copy of the MCP Registry in Postgres; API processes keep it synced. */
	mcpIndex: McpRegistryIndex;
	now: () => Date;
}

export async function createDeps(env: Env, log: pino.Logger, role: string): Promise<Deps> {
	const now = () => new Date();
	const db = createDatabases(env, `skillpouch-${role}`);
	const mcpRegistry = new McpRegistryClient();
	const hub = new ListenHub(env.DATABASE_URL, log);
	return {
		env,
		log,
		db,
		auth: createAuth({ env, db: db.app }),
		tokens: await AccessTokens.create(env.JWT_SIGNING_KEY, now),
		nonces: new NonceService(env.DPOP_NONCE_SECRET, now),
		pepper: new PepperBox(env.PEPPER_KEY, env.PEPPER_KEY_ID),
		blobs: createBlobStore(env),
		hub,
		deviceStatus: new DeviceStatusCache(db.app),
		settings: new SettingsCache(db.app, env.MAINTENANCE_WRITE_PAUSE),
		billing:
			env.POLAR_ACCESS_TOKEN && env.POLAR_WEBHOOK_SECRET
				? new PolarProvider({
						accessToken: env.POLAR_ACCESS_TOKEN,
						webhookSecret: env.POLAR_WEBHOOK_SECRET,
						server: env.POLAR_SERVER,
						now,
					})
				: null,
		github: new GithubImporter(fetch, env.GITHUB_PUBLIC_TOKEN),
		githubApp:
			env.GITHUB_APP_ID &&
			env.GITHUB_APP_SLUG &&
			env.GITHUB_APP_CLIENT_ID &&
			env.GITHUB_APP_CLIENT_SECRET &&
			env.GITHUB_APP_PRIVATE_KEY
				? new GithubApp(
						{
							appId: env.GITHUB_APP_ID,
							slug: env.GITHUB_APP_SLUG,
							clientId: env.GITHUB_APP_CLIENT_ID,
							clientSecret: env.GITHUB_APP_CLIENT_SECRET,
							privateKey: env.GITHUB_APP_PRIVATE_KEY,
						},
						fetch,
						now,
					)
				: null,
		skillsSh: new SkillsShClient(),
		cliReleases: new CliReleases(),
		mcpRegistry,
		mcpIndex: new McpRegistryIndex(mcpRegistry, db, now),
		now,
	};
}

export async function closeDeps(deps: Deps): Promise<void> {
	await deps.hub.close();
	await deps.db.close();
}

export function createBlobStore(env: Env): BlobStore {
	if (env.BLOB_DRIVER === 'fs') return new FsBlobStore(env.BLOB_FS_ROOT);
	return new S3BlobStore({
		endpoint: env.S3_ENDPOINT!,
		bucket: env.S3_BUCKET!,
		region: env.S3_REGION,
		accessKeyId: env.S3_ACCESS_KEY_ID!,
		secretAccessKey: env.S3_SECRET_ACCESS_KEY!,
		prefix: env.S3_PREFIX,
	});
}
