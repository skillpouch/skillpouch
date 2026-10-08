// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Billing through Polar (merchant of record). The app never sees card data:
 * checkout and the customer portal are hosted pages; their URLs come from
 * the API and the browser simply navigates there.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { api } from '@/lib/api/client';
import { queryKeys } from '@/lib/api/query-keys';
import type { BillingOverview, Invoice, PlanRecord } from '@/lib/api/types';

export function usePlans() {
	return useQuery({
		queryKey: queryKeys.plans,
		queryFn: async () => (await api.get<{ plans: PlanRecord[] }>('/v1/plans')).plans,
		staleTime: 10 * 60_000,
	});
}

/** The entry-level paid plan, pitched to free users. */
export function cheapestPaidPlan(plans: PlanRecord[] | undefined): PlanRecord | undefined {
	return (plans ?? [])
		.filter((plan) => plan.price_cents > 0)
		.reduce<PlanRecord | undefined>(
			(cheapest, plan) =>
				!cheapest || plan.price_cents < cheapest.price_cents ? plan : cheapest,
			undefined,
		);
}

export function useBilling() {
	return useQuery({
		queryKey: queryKeys.billing,
		queryFn: () => api.get<BillingOverview>('/v1/billing'),
	});
}

export function useInvoices(enabled: boolean) {
	return useQuery({
		queryKey: queryKeys.invoices,
		queryFn: async () =>
			(await api.get<{ invoices: Invoice[] }>('/v1/billing/invoices')).invoices,
		enabled,
	});
}

/** Hosted pages are only ever opened on the payment provider's own https origin. */
function go(url: string): void {
	const parsed = new URL(url);
	if (parsed.protocol !== 'https:' && !import.meta.env.DEV)
		throw new Error('Unexpected billing link.');
	location.assign(parsed.toString());
}

export function useCheckout() {
	return useMutation({
		mutationFn: async (planSlug: string) => {
			const { url } = await api.post<{ url: string }>('/v1/billing/checkout', {
				plan_slug: planSlug,
			});
			go(url);
		},
	});
}

export function usePortal() {
	return useMutation({
		mutationFn: async () => {
			const { url } = await api.post<{ url: string }>('/v1/billing/portal');
			go(url);
		},
	});
}

export type BillingDocument = 'invoice' | 'receipt';

/**
 * Opens a charge's invoice or receipt PDF in a new tab. The tab opens right
 * away (a tab opened after the request would be blocked as a popup) and
 * follows the link once the provider has rendered the PDF.
 */
export async function openBillingDocument(
	invoiceId: string,
	document: BillingDocument,
): Promise<void> {
	const tab = window.open('about:blank', '_blank');
	if (tab) tab.opener = null;
	try {
		const { url } = await api.get<{ url: string }>(
			`/v1/billing/invoices/${invoiceId}/${document === 'invoice' ? 'pdf' : 'receipt'}`,
		);
		if (tab) tab.location.href = url;
		else window.open(url, '_blank', 'noopener,noreferrer');
	} catch (error) {
		tab?.close();
		throw error;
	}
}

/**
 * Pulls the account's subscriptions from the provider when the billing page
 * opens, so a payment shows up even if its webhook is late.
 */
export function useBillingSync(enabled: boolean): void {
	const client = useQueryClient();
	useEffect(() => {
		if (!enabled) return;
		void api
			.post<{ changed: number }>('/v1/billing/sync')
			.then(({ changed }) => {
				if (changed === 0) return;
				void client.invalidateQueries({ queryKey: queryKeys.billing });
				void client.invalidateQueries({ queryKey: queryKeys.me });
				void client.invalidateQueries({ queryKey: queryKeys.storage });
			})
			.catch(() => {});
	}, [client, enabled]);
}
