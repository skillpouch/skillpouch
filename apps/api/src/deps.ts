// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The dependency container (plan 06 §2): one plain object built in `main.ts`
 * (or by tests) and passed explicitly to routes and services. No DI framework,
 * no module-level singletons.
 */
import type pino from 'pino';
import type { Env } from './config/env';
import type { BlobStore } from './infra/blob-store/blob-store';
import { FsBlobStore } from './infra/blob-store/fs-blob-store';
import { createDatabases, type Databases } from './infra/db';
import { ListenHub } from './infra/listen-hub';
import { SettingsCache } from './infra/settings';
import { createAuth, type Auth } from './modules/auth/better-auth';
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
	/** Seals/opens per-account unlock peppers with the off-DB PEPPER_KEY (15 §4.1). */
	pepper: PepperBox;
	blobs: BlobStore;
	hub: ListenHub;
	deviceStatus: DeviceStatusCache;
	settings: SettingsCache;
	now: () => Date;
}

export async function createDeps(env: Env, log: pino.Logger, role: string): Promise<Deps> {
	const now = () => new Date();
	const db = createDatabases(env, `skillpouch-${role}`);
	const hub = new ListenHub(env.DATABASE_URL, log);
	return {
		env,
		log,
		db,
		auth: createAuth({ env, db: db.app }),
		tokens: await AccessTokens.create(env.JWT_SIGNING_KEY, now),
		nonces: new NonceService(env.DPOP_NONCE_SECRET, now),
		pepper: new PepperBox(env.PEPPER_KEY, env.PEPPER_KEY_ID),
		blobs: new FsBlobStore(env.BLOB_FS_ROOT),
		hub,
		deviceStatus: new DeviceStatusCache(db.app),
		settings: new SettingsCache(db.app, env.MAINTENANCE_WRITE_PAUSE),
		now,
	};
}

export async function closeDeps(deps: Deps): Promise<void> {
	await deps.hub.close();
	await deps.db.close();
}
