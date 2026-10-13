// SPDX-License-Identifier: AGPL-3.0-only
/** The public plans from the app's API: read at build time for the HTML, and again in the browser. */
import type { Plan } from '@/components/landing-content';
import { PLANS_URL } from '@/lib/links';

export async function loadPlans(signal?: AbortSignal): Promise<Plan[]> {
	const response = await fetch(PLANS_URL, { credentials: 'omit', signal: signal ?? null });
	if (!response.ok) throw new Error(`plans: ${response.status}`);
	const body = (await response.json()) as { data?: { plans?: Plan[] } };
	return body.data?.plans ?? [];
}

/**
 * The plans at build time, so pricing is in the page for readers without
 * JavaScript and for search engines. A build that can't reach the API still
 * succeeds; the page then loads them in the browser as before.
 */
export async function buildTimePlans(): Promise<Plan[] | undefined> {
	try {
		const plans = await loadPlans(AbortSignal.timeout(5000));
		return plans.length ? plans : undefined;
	} catch {
		return undefined;
	}
}
