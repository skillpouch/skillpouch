// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Development helpers on `window.__skillpouchDev`, for trying plan limits by
 * hand and for the end-to-end tests. Only loaded by the dev server; the API
 * side (`/v1/dev/*`) does not exist in production either.
 */
import { api } from './api/client';
import { queryClient } from './query-client';

interface AdminPlanRecord {
	id: string;
	slug: string;
	name: string;
	description: string;
	price_cents: number;
	currency: string;
	interval: 'month' | 'year' | null;
	pouch_limit: number;
	storage_bytes: number;
	polar_product_id: string | null;
	is_public: boolean;
	is_active: boolean;
	sort: number;
}

export interface DevTools {
	/** Moves the signed-in account to a plan (`free`, `supporter`, …). */
	setPlan(planSlug: string): Promise<void>;
	/**
	 * Saves every paid plan once through the admin API, which creates (or
	 * updates) its product in Polar. Needs your email in `ADMIN_EMAILS`.
	 */
	syncPlans(): Promise<{ slug: string; polar_product_id: string | null }[]>;
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
		async syncPlans() {
			const { plans } = await api.get<{ plans: AdminPlanRecord[] }>('/v1/admin/plans');
			const synced = [];
			for (const plan of plans.filter((entry) => entry.price_cents > 0)) {
				const saved = await api.put<AdminPlanRecord>(`/v1/admin/plans/${plan.id}`, {
					name: plan.name,
					description: plan.description,
					price_cents: plan.price_cents,
					currency: plan.currency,
					interval: plan.interval,
					pouch_limit: plan.pouch_limit,
					storage_bytes: plan.storage_bytes,
					is_public: plan.is_public,
					is_active: plan.is_active,
					sort: plan.sort,
					reason: 'dev: sync plan with the billing provider',
				});
				synced.push({ slug: saved.slug, polar_product_id: saved.polar_product_id });
			}
			await queryClient.invalidateQueries();
			return synced;
		},
	};
}
