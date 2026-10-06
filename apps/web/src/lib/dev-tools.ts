// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Development helpers on `window.__skillpouchDev`, for trying plan limits by
 * hand and for the end-to-end tests. Only loaded by the dev server; the API
 * side (`/v1/dev/*`) does not exist in production either.
 */
import { api } from './api/client';
import { queryClient } from './query-client';

export interface DevTools {
	/** Moves the signed-in account to a plan (`free`, `supporter`, …). */
	setPlan(planSlug: string): Promise<void>;
}

declare global {
	interface Window {
		__skillpouchDev?: DevTools;
	}
}

export function installDevTools(): void {
	window.__skillpouchDev = {
		async setPlan(planSlug) {
			await api.post('/v1/dev/plan', { plan_slug: planSlug });
			await queryClient.invalidateQueries();
		},
	};
}
