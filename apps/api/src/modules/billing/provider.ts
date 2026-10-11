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
	/** An invoice PDF exists or can be generated on request. */
	invoiceAvailable: boolean;
	/** The provider issued a receipt PDF for the payment. */
	receiptAvailable: boolean;
}

export type BillingDocument = 'invoice' | 'receipt';

/** A charge as the admin dashboard counts it: what was paid, kept and refunded. */
export interface NormalizedPayment {
	id: string;
	storageAccountId: string | null;
	productId: string | null;
	status: NormalizedInvoice['status'];
	currency: string;
	/** What the customer paid, tax included. */
	amountCents: number;
	/** After discounts and before tax: what the business earns. */
	netCents: number;
	taxCents: number;
	refundedCents: number;
	createdAt: Date;
}

/**
 * How a plan change settles the price difference: `now` charges (or
 * credits) it right away, `next_invoice` adds it to the next renewal.
 */
export type Proration = 'now' | 'next_invoice';

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
	/**
	 * Send the price to an existing product. Polar creates a new price whenever prices are sent,
	 * so a name or description change leaves it out.
	 */
	updatePrice: boolean;
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
	/** Shown on the pricing and billing pages; hidden plans are only granted by an admin. */
	visible: boolean;
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
	/**
	 * Moves a subscription to another product right away; returns its new
	 * state. Throws `payment_failed` when the charge fails and
	 * `plan_change_unavailable` when the subscription can't change.
	 */
	changePlan(input: {
		externalSubscriptionId: string;
		productId: string;
		proration: Proration;
	}): Promise<NormalizedSubscription>;
	/** Every subscription of one account, straight from the provider. */
	listSubscriptions(storageAccountId: string): Promise<NormalizedSubscription[]>;
	/** Newest first; empty when the account never paid. */
	listInvoices(storageAccountId: string, limit: number): Promise<NormalizedInvoice[]>;
	/**
	 * PDF link for one of this account's charges, generated first if needed;
	 * null when the charge isn't this account's or has no such document.
	 */
	documentUrl(
		storageAccountId: string,
		invoiceId: string,
		document: BillingDocument,
	): Promise<string | null>;
	/** Creates or updates the provider product for a paid plan; returns its id. */
	syncProduct(input: PlanProductInput): Promise<string>;
	/** Every active recurring product tagged with a plan slug. */
	listPlanProducts(): Promise<PlanProduct[]>;
	/**
	 * Every charge of every customer, newest first. Stops after the first
	 * page holding one created before `since` (older ones don't change).
	 */
	listPayments(since: Date | null): Promise<NormalizedPayment[]>;
}
