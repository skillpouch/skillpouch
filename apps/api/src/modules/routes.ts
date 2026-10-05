// SPDX-License-Identifier: AGPL-3.0-only
/** Registers every feature module's routes (plan 06 §2, §3). */
import type { Deps } from '../deps';
import type { ZodApp } from '../http/zod-app';
import { accountRoutes } from './account/account.routes';
import { cliAuthRoutes } from './cli-auth/cli-auth.routes';
import { devicesRoutes } from './devices/devices.routes';
import { healthRoutes, type HealthState } from './health/health.routes';
import { pouchesRoutes } from './pouches/pouches.routes';
import { rosterRoutes } from './roster/roster.routes';
import { sessionRoutes } from './session/session.routes';

export async function registerModules(app: ZodApp, deps: Deps, health: HealthState): Promise<void> {
	await healthRoutes(app, deps, health);
	await sessionRoutes(app, deps);
	await accountRoutes(app, deps);
	await cliAuthRoutes(app, deps);
	await devicesRoutes(app, deps);
	await rosterRoutes(app, deps);
	await pouchesRoutes(app, deps);
}
