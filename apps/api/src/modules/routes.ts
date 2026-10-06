// SPDX-License-Identifier: AGPL-3.0-only
/** Registers every feature module's routes (plan 06 §2, §3). */
import type { Deps } from '../deps';
import type { ZodApp } from '../http/zod-app';
import { accountRoutes } from './account/account.routes';
import { artifactsRoutes } from './artifacts/artifacts.routes';
import { blobsRoutes } from './blobs/blobs.routes';
import { cliAuthRoutes } from './cli-auth/cli-auth.routes';
import { conflictsRoutes } from './conflicts/conflicts.routes';
import { devicesRoutes } from './devices/devices.routes';
import { eventsRoutes } from './events/events.routes';
import { healthRoutes, type HealthState } from './health/health.routes';
import { operationsRoutes } from './operations/operations.routes';
import { pouchesRoutes } from './pouches/pouches.routes';
import { rosterRoutes } from './roster/roster.routes';
import { sessionRoutes } from './session/session.routes';
import { snapshotsRoutes } from './snapshots/snapshots.routes';
import { unlockRoutes } from './unlock/unlock.routes';

export async function registerModules(app: ZodApp, deps: Deps, health: HealthState): Promise<void> {
	await healthRoutes(app, deps, health);
	await sessionRoutes(app, deps);
	await accountRoutes(app, deps);
	await cliAuthRoutes(app, deps);
	await devicesRoutes(app, deps);
	await rosterRoutes(app, deps);
	await unlockRoutes(app, deps);
	await pouchesRoutes(app, deps);
	await blobsRoutes(app, deps);
	await operationsRoutes(app, deps);
	await eventsRoutes(app, deps);
	await snapshotsRoutes(app, deps);
	await artifactsRoutes(app, deps);
	await conflictsRoutes(app, deps);
}
