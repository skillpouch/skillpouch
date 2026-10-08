// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Polar (merchant of record) over its REST API.
 *
 * Webhooks follow the Standard Webhooks spec: `webhook-signature` carries
 * `v1,<base64 HMAC-SHA256(secret, id.timestamp.body)>`; Polar uses the
 * secret's UTF-8 bytes as the HMAC key. Timestamps older than 5 minutes are
 * rejected (replay protection); event ids make processing idempotent.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { IncomingHttpHeaders } from 'node:http';
import { AppError } from '../../http/app-error';
import type {
	BillingEvent,
	BillingProvider,
	NormalizedInvoice,
	NormalizedSubscription,
	PlanProduct,
	PlanProductInput,
} from './provider';

const TOLERANCE_SECONDS = 300;

export interface PolarOptions {
	accessToken: string;
	webhookSecret: string;
	server: 'sandbox' | 'production';
	fetch?: typeof fetch;
	now?: () => Date;
}

function header(headers: IncomingHttpHeaders, name: string): string {
	const value = headers[name];
	return Array.isArray(value) ? (value[0] ?? '') : (value ?? '');
}

/** Standard Webhooks signature check, shared with tests. */
export function signStandardWebhook(
	secret: string,
	id: string,
	timestamp: number,
	body: string,
): string {
	const key = secret.startsWith('whsec_')
		? Buffer.from(secret.slice(6), 'base64')
		: Buffer.from(secret, 'utf8');
	return createHmac('sha256', key).update(`${id}.${timestamp}.${body}`).digest('base64');
}

export function verifyStandardWebhook(
	secret: string,
	rawBody: Buffer,
	headers: IncomingHttpHeaders,
	now: Date,
): { id: string; payload: unknown } {
	const id = header(headers, 'webhook-id');
	const timestamp = Number(header(headers, 'webhook-timestamp'));
	const signatures = header(headers, 'webhook-signature').split(' ');
	if (!id || !Number.isInteger(timestamp))
		throw new AppError('webhook_invalid', { reason: 'headers' });
	if (Math.abs(now.getTime() / 1000 - timestamp) > TOLERANCE_SECONDS) {
		throw new AppError('webhook_invalid', { reason: 'timestamp' });
	}
	const expected = Buffer.from(
		signStandardWebhook(secret, id, timestamp, rawBody.toString('utf8')),
	);
	const valid = signatures.some((entry) => {
		const [version, signature] = entry.split(',');
		const candidate = Buffer.from(signature ?? '');
		return (
			version === 'v1' &&
			candidate.length === expected.length &&
			timingSafeEqual(candidate, expected)
		);
	});
	if (!valid) throw new AppError('webhook_invalid', { reason: 'signature' });
	try {
		return { id, payload: JSON.parse(rawBody.toString('utf8')) };
	} catch {
		throw new AppError('webhook_invalid', { reason: 'body' });
	}
}

const dateOrNull = (value: unknown): Date | null => (value ? new Date(String(value)) : null);

/**
 * Maps a Polar subscription object to our shape. Polar statuses: `active`,
 * `trialing`, `past_due`, `canceled`, `unpaid`, `incomplete(_expired)`. A
 * cancel-at-period-end subscription stays `active` until the period ends; a
 * revoked one is `canceled` with `ended_at` set, which then ends access.
 */
export function normalizePolarSubscription(data: Record<string, unknown>): NormalizedSubscription {
	const customer = (data.customer ?? {}) as Record<string, unknown>;
	const metadata = (data.metadata ?? {}) as Record<string, unknown>;
	const externalId = (customer.external_id ?? metadata.storage_account_id ?? null) as
		string | null;
	const interval = data.recurring_interval;
	return {
		externalSubscriptionId: String(data.id),
		externalCustomerId: String(data.customer_id ?? customer.id ?? ''),
		storageAccountId: externalId,
		productId: (data.product_id as string | undefined) ?? null,
		status: String(data.status ?? 'unknown'),
		interval: interval === 'month' || interval === 'year' ? interval : null,
		amountCents: Number(data.amount ?? 0),
		currentPeriodEnd: dateOrNull(data.ended_at) ?? dateOrNull(data.current_period_end),
		cancelAtPeriodEnd: Boolean(data.cancel_at_period_end),
		providerUpdatedAt: dateOrNull(data.modified_at) ?? dateOrNull(data.created_at),
	};
}

const ORDER_STATUSES = new Set(['paid', 'refunded', 'partially_refunded', 'pending', 'failed']);

export function normalizePolarOrder(data: Record<string, unknown>): NormalizedInvoice {
	const status = String(data.status ?? 'pending');
	const product = data.product as { name?: string } | undefined;
	return {
		id: String(data.id),
		createdAt: dateOrNull(data.created_at) ?? new Date(0),
		description: product?.name ?? String(data.description ?? 'SkillPouch'),
		amountCents: Number(data.total_amount ?? data.amount ?? 0),
		currency: String(data.currency ?? 'usd'),
		status: (ORDER_STATUSES.has(status) ? status : 'pending') as NormalizedInvoice['status'],
		invoiceAvailable: Boolean(data.is_invoice_generated),
	};
}

/** Same shape as plan slugs created in the admin dashboard. */
const PLAN_SLUG = /^[a-z0-9-]{2,64}$/;

/** A positive whole number from metadata (Polar keeps numbers; strings are accepted too). */
function wholeNumber(value: unknown): number | null {
	const number = typeof value === 'string' && value.trim() ? Number(value) : value;
	return typeof number === 'number' && Number.isSafeInteger(number) && number > 0 ? number : null;
}

/**
 * Maps a Polar product to the plan it sells, or null when it isn't one: not
 * tagged with `plan`, archived, one-time, or without a fixed active price.
 */
export function planProductFromPolar(data: Record<string, unknown>): PlanProduct | null {
	const metadata = (data.metadata ?? {}) as Record<string, unknown>;
	const slug = typeof metadata.plan === 'string' ? metadata.plan.trim() : '';
	const interval = data.recurring_interval;
	if (!PLAN_SLUG.test(slug) || data.is_archived || (interval !== 'month' && interval !== 'year'))
		return null;
	const prices = (data.prices ?? []) as Record<string, unknown>[];
	const price = prices.find((entry) => entry.amount_type === 'fixed' && !entry.is_archived);
	if (!price || typeof price.price_amount !== 'number') return null;
	return {
		productId: String(data.id),
		slug,
		name: String(data.name ?? slug),
		description: typeof data.description === 'string' ? data.description : '',
		priceCents: price.price_amount,
		currency: String(price.price_currency ?? 'usd').toLowerCase(),
		interval,
		pouchLimit: wholeNumber(metadata.pouch_limit),
		storageBytes: wholeNumber(metadata.storage_bytes),
	};
}

export class PolarProvider implements BillingProvider {
	readonly name = 'polar';
	private readonly base: string;
	private readonly fetch: typeof fetch;
	private readonly now: () => Date;

	constructor(private readonly options: PolarOptions) {
		this.base =
			options.server === 'production'
				? 'https://api.polar.sh'
				: 'https://sandbox-api.polar.sh';
		this.fetch = options.fetch ?? fetch;
		this.now = options.now ?? (() => new Date());
	}

	private async call<T>(method: string, path: string, body?: unknown): Promise<T> {
		const response = await this.fetch(`${this.base}${path}`, {
			method,
			headers: {
				Authorization: `Bearer ${this.options.accessToken}`,
				'Content-Type': 'application/json',
				Accept: 'application/json',
			},
			...(body === undefined ? {} : { body: JSON.stringify(body) }),
			signal: AbortSignal.timeout(10_000),
		});
		if (!response.ok) {
			throw new AppError('billing_unavailable', { status: response.status, path });
		}
		return (await response.json()) as T;
	}

	async createCheckout(input: {
		storageAccountId: string;
		email: string;
		productId: string;
		successUrl: string;
	}) {
		const checkout = await this.call<{ url: string }>('POST', '/v1/checkouts/', {
			products: [input.productId],
			external_customer_id: input.storageAccountId,
			customer_email: input.email,
			success_url: input.successUrl,
			metadata: { storage_account_id: input.storageAccountId },
		});
		return { url: checkout.url };
	}

	async createPortalSession(input: { storageAccountId: string }) {
		const session = await this.call<{ customer_portal_url: string }>(
			'POST',
			'/v1/customer-sessions/',
			{
				external_customer_id: input.storageAccountId,
			},
		);
		return { url: session.customer_portal_url };
	}

	async verifyWebhook(rawBody: Buffer, headers: IncomingHttpHeaders): Promise<BillingEvent> {
		const { id, payload } = verifyStandardWebhook(
			this.options.webhookSecret,
			rawBody,
			headers,
			this.now(),
		);
		const event = payload as { type?: string; data?: Record<string, unknown> };
		const type = String(event.type ?? 'unknown');
		return {
			id,
			type,
			payload,
			subscription:
				type.startsWith('subscription.') && event.data
					? normalizePolarSubscription(event.data)
					: null,
		};
	}

	/** Polar customer id for our storage account, or null before the first checkout. */
	private async customerId(storageAccountId: string): Promise<string | null> {
		try {
			const customer = await this.call<{ id: string }>(
				'GET',
				`/v1/customers/external/${encodeURIComponent(storageAccountId)}`,
			);
			return customer.id;
		} catch (error) {
			if (error instanceof AppError && error.details?.status === 404) return null;
			throw error;
		}
	}

	async listInvoices(storageAccountId: string, limit: number): Promise<NormalizedInvoice[]> {
		const customerId = await this.customerId(storageAccountId);
		if (!customerId) return [];
		const page = await this.call<{ items: Record<string, unknown>[] }>(
			'GET',
			`/v1/orders/?customer_id=${encodeURIComponent(customerId)}&sorting=-created_at&limit=${limit}`,
		);
		return page.items.map(normalizePolarOrder);
	}

	async invoiceUrl(storageAccountId: string, invoiceId: string): Promise<string | null> {
		const customerId = await this.customerId(storageAccountId);
		if (!customerId) return null;
		const order = await this.call<Record<string, unknown>>(
			'GET',
			`/v1/orders/${encodeURIComponent(invoiceId)}`,
		).catch((error: unknown) => {
			if (error instanceof AppError && error.details?.status === 404) return null;
			throw error;
		});
		// Another customer's order is "not found" for this account.
		if (!order || order.customer_id !== customerId || !order.is_invoice_generated) return null;
		const invoice = await this.call<{ url: string }>(
			'GET',
			`/v1/orders/${encodeURIComponent(invoiceId)}/invoice`,
		);
		return invoice.url;
	}

	async fetchSubscription(externalSubscriptionId: string) {
		const data = await this.call<Record<string, unknown>>(
			'GET',
			`/v1/subscriptions/${encodeURIComponent(externalSubscriptionId)}`,
		);
		return normalizePolarSubscription(data);
	}

	async syncProduct(input: PlanProductInput): Promise<string> {
		const prices = [
			{
				amount_type: 'fixed',
				price_amount: input.priceCents,
				price_currency: input.currency.toLowerCase(),
			},
		];
		if (input.productId) {
			// Polar never edits a price in place: sending prices creates a new one; existing subscribers keep theirs.
			const updated = await this.call<{ id: string }>(
				'PATCH',
				`/v1/products/${input.productId}`,
				{
					name: input.name,
					description: input.description,
					prices,
				},
			);
			return updated.id;
		}
		const created = await this.call<{ id: string }>('POST', '/v1/products/', {
			name: input.name,
			description: input.description,
			recurring_interval: input.interval,
			prices,
			metadata: { plan: input.slug },
		});
		return created.id;
	}

	async listPlanProducts(): Promise<PlanProduct[]> {
		const products: PlanProduct[] = [];
		for (let page = 1; ; page++) {
			const result = await this.call<{
				items: Record<string, unknown>[];
				pagination: { max_page: number };
			}>('GET', `/v1/products/?is_archived=false&limit=100&page=${page}`);
			for (const item of result.items) {
				const product = planProductFromPolar(item);
				if (product) products.push(product);
			}
			if (page >= result.pagination.max_page) return products;
		}
	}
}
