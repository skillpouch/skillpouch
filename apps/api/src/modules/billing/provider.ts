// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Provider-agnostic billing (plan 09 §4, 18 §4). Polar is the only v1
 * implementation; tests use a fake. Everything the rest of the API needs is
 * normalized here so no Polar shape leaks outside `polar.ts`.
 */
import type { IncomingHttpHeaders } from 'node:http';

export interface NormalizedSubscription {
	externalSubscriptionId: string;
	externalCustomerId: string;
	/** Our storage account id, carried as the provider's customer external id. */
	storageAccountId: string | null;
	productId: string | null;
	status: string;
	interval: 'month' | 'year' | null;
	amountCents: number;
	/** When access ends: the period end, or the moment a revoked subscription ended. */
	currentPeriodEnd: Date | null;
	cancelAtPeriodEnd: boolean;
	/** Provider-side modification time; orders out-of-order webhook deliveries. */
	providerUpdatedAt: Date | null;
}

export interface BillingEvent {
	/** Provider event id — the idempotency key. */
	id: string;
	type: string;
	payload: unknown;
	subscription: NormalizedSubscription | null;
}

export interface PlanProductInput {
	productId: string | null;
	name: string;
	description: string;
	priceCents: number;
	currency: string;
	interval: 'month' | 'year';
}

export interface BillingProvider {
	readonly name: string;
	createCheckout(input: {
		storageAccountId: string;
		email: string;
		productId: string;
		successUrl: string;
	}): Promise<{ url: string }>;
	createPortalSession(input: { storageAccountId: string }): Promise<{ url: string }>;
	/** Throws `webhook_invalid` on a bad signature or stale timestamp. */
	verifyWebhook(rawBody: Buffer, headers: IncomingHttpHeaders): Promise<BillingEvent>;
	fetchSubscription(externalSubscriptionId: string): Promise<NormalizedSubscription | null>;
	/** Creates or updates the provider product for a paid plan; returns its id. */
	syncProduct(input: PlanProductInput): Promise<string>;
}
