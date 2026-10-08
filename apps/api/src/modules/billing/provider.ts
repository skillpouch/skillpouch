// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Provider-agnostic billing. Polar is the only v1
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

/** One charge (Polar "order"): a payment, a renewal or a refund. */
export interface NormalizedInvoice {
	id: string;
	createdAt: Date;
	description: string;
	amountCents: number;
	currency: string;
	status: 'paid' | 'refunded' | 'partially_refunded' | 'pending' | 'failed';
	/** The provider has a PDF for it (generated from the customer portal). */
	invoiceAvailable: boolean;
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
	/** Tagged on new products as metadata `plan`, so they link back to the plan. */
	slug: string;
	name: string;
	description: string;
	priceCents: number;
	currency: string;
	interval: 'month' | 'year';
}

/**
 * A provider product tagged with metadata `plan=<slug>`: the plan it sells,
 * its current price and, for plans that don't exist yet, their limits.
 */
export interface PlanProduct {
	productId: string;
	slug: string;
	name: string;
	description: string;
	priceCents: number;
	currency: string;
	interval: 'month' | 'year';
	pouchLimit: number | null;
	storageBytes: number | null;
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
	/** Newest first; empty when the account never paid. */
	listInvoices(storageAccountId: string, limit: number): Promise<NormalizedInvoice[]>;
	/** PDF link of one of this account's invoices, or null when none exists (yet). */
	invoiceUrl(storageAccountId: string, invoiceId: string): Promise<string | null>;
	/** Creates or updates the provider product for a paid plan; returns its id. */
	syncProduct(input: PlanProductInput): Promise<string>;
	/** Every active recurring product tagged with a plan slug. */
	listPlanProducts(): Promise<PlanProduct[]>;
}
