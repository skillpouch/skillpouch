// SPDX-License-Identifier: AGPL-3.0-only
/** Registers every feature module's routes. */
import type { Deps } from '../deps';
import type { ZodApp } from '../http/zod-app';
import { accountRoutes } from './account/account.routes';
import { adminRoutes } from './admin/admin.routes';
import { artifactsRoutes } from './artifacts/artifacts.routes';
import { authRoutes } from './auth/auth.routes';
import { billingRoutes } from './billing/billing.routes';
import { blobsRoutes } from './blobs/blobs.routes';
import { cliAuthRoutes } from './cli-auth/cli-auth.routes';
import { conflictsRoutes } from './conflicts/conflicts.routes';
import { devRoutes } from './dev/dev.routes';
import { devicesRoutes } from './devices/devices.routes';
import { eventsRoutes } from './events/events.routes';
import { importRoutes } from './import/import.routes';
import { marketplacesRoutes } from './marketplaces/marketplaces.routes';
import { healthRoutes, type HealthState } from './health/health.routes';
import { operationsRoutes } from './operations/operations.routes';
import { pouchesRoutes } from './pouches/pouches.routes';
import { rosterRoutes } from './roster/roster.routes';
import { sessionRoutes } from './session/session.routes';
import { sharesRoutes } from './shares/shares.routes';
import { snapshotsRoutes } from './snapshots/snapshots.routes';
import { storageRoutes } from './storage/storage.routes';
import { unlockRoutes } from './unlock/unlock.routes';
import { usageRoutes } from './usage/usage.routes';

export async function registerModules(app: ZodApp, deps: Deps, health: HealthState): Promise<void> {
	await healthRoutes(app, deps, health);
	await authRoutes(app, deps);
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
	await storageRoutes(app, deps);
	await sharesRoutes(app, deps);
	await billingRoutes(app, deps);
	await adminRoutes(app, deps);
	await importRoutes(app, deps);
	await marketplacesRoutes(app, deps);
	await usageRoutes(app, deps);
	await devRoutes(app, deps);
}
