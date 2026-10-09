// SPDX-License-Identifier: AGPL-3.0-only
import { z } from 'zod';
import { Timestamp, Uuid } from './common';
import { Entitlements } from './account';

/** Every admin mutation carries a reason, written to the audit log. */
const Reason = z.string().trim().min(3).max(500);

export const AdminOverview = z.object({
	users: z.number().int(),
	signups_7d: z.number().int(),
	active_devices_30d: z.number().int(),
	pouches: z.number().int(),
	storage_used_bytes: z.number().int(),
	active_subscriptions: z.number().int(),
	mrr_cents: z.number().int(),
});

export const AdminUser = z.object({
	id: z.string(),
	email: z.string(),
	name: z.string(),
	role: z.enum(['user', 'admin']),
	suspended_at: Timestamp.nullable(),
	created_at: Timestamp,
	storage_account_id: Uuid.nullable(),
	entitlements: Entitlements.nullable(),
	used_bytes: z.number().int(),
	device_count: z.number().int(),
	pouch_count: z.number().int(),
});

export const AdminUserQuery = z.object({
	q: z.string().max(200).optional(),
	cursor: z.string().max(200).optional(),
	limit: z.coerce.number().int().min(1).max(200).default(50),
});

export const AdminSetRole = z.strictObject({ role: z.enum(['user', 'admin']), reason: Reason });
export const AdminReason = z.strictObject({ reason: Reason });

export const AdminSetOverride = z.strictObject({
	pouch_limit: z.number().int().min(0).max(1000).nullable(),
	storage_bytes: z.number().int().min(0).nullable(),
	expires_at: Timestamp.nullable().default(null),
	note: z.string().max(500).default(''),
	reason: Reason,
});

export const AdminGrantPlan = z.strictObject({
	plan_slug: z.string().min(1).max(64),
	ends_at: Timestamp.nullable().default(null),
	reason: Reason,
});

export const AdminPlanInput = z.strictObject({
	slug: z
		.string()
		.regex(/^[a-z0-9-]{2,64}$/)
		.optional(),
	name: z.string().min(1).max(100),
	description: z.string().max(1000).default(''),
	price_cents: z.number().int().min(0),
	currency: z.string().length(3).default('usd'),
	interval: z.enum(['month', 'year']).nullable(),
	pouch_limit: z.number().int().min(0),
	storage_bytes: z.number().int().min(0),
	is_public: z.boolean().default(true),
	is_active: z.boolean().default(true),
	sort: z.number().int().default(0),
	reason: Reason,
});

export const AdminPlan = z.object({
	id: Uuid,
	slug: z.string(),
	name: z.string(),
	description: z.string(),
	price_cents: z.number().int(),
	currency: z.string(),
	interval: z.enum(['month', 'year']).nullable(),
	pouch_limit: z.number().int(),
	storage_bytes: z.number().int(),
	polar_product_id: z.string().nullable(),
	is_default: z.boolean(),
	is_public: z.boolean(),
	is_active: z.boolean(),
	sort: z.number().int(),
});

export const WritePause = z.strictObject({ enabled: z.boolean(), reason: Reason });

export const AuditEntry = z.object({
	id: Uuid,
	storage_account_id: Uuid.nullable(),
	actor: z.string(),
	action: z.string(),
	target: z.string().nullable(),
	details: z.record(z.string(), z.unknown()),
	created_at: Timestamp,
});

export const BillingCheckout = z.strictObject({ plan_slug: z.string().min(1).max(64) });
export const BillingUrl = z.object({ url: z.url() });

export const AdminAnalyticsQuery = z.object({
	days: z.coerce.number().int().min(7).max(365).default(30),
});

const Count = z.object({ name: z.string(), count: z.number().int() });

/**
 * The dashboard's numbers over the last `days` UTC days (today included).
 * Money is in `currency` (the one most charges use; others are left out of
 * the sums) and counts what the business keeps: after discounts, tax and
 * refunds.
 */
export const AdminAnalytics = z.object({
	days: z.number().int(),
	currency: z.string(),
	series: z.array(
		z.object({
			day: z.string(),
			signups: z.number().int(),
			devices: z.number().int(),
			earned_cents: z.number().int(),
			payments: z.number().int(),
			tokens: z.number(),
		}),
	),
	revenue: z.object({
		mrr_cents: z.number().int(),
		earned_cents: z.number().int(),
		previous_earned_cents: z.number().int(),
		all_time_cents: z.number().int(),
		refunded_cents: z.number().int(),
		payments: z.number().int(),
		paying_accounts: z.number().int(),
		/** Charges in other currencies, not in the sums. */
		other_currencies: z.array(z.string()),
		synced_at: Timestamp.nullable(),
	}),
	users: z.object({
		total: z.number().int(),
		new: z.number().int(),
		previous_new: z.number().int(),
		/** Connected at least one computer. */
		with_devices: z.number().int(),
		suspended: z.number().int(),
	}),
	subscriptions: z.object({
		by_status: z.array(Count),
		cancel_scheduled: z.number().int(),
	}),
	plans: z.array(z.object({ slug: z.string(), name: z.string(), accounts: z.number().int() })),
	devices: z.object({
		active: z.number().int(),
		seen_7d: z.number().int(),
		seen_30d: z.number().int(),
		os: z.array(Count),
		cli_versions: z.array(Count),
	}),
	tokens: z.object({
		total: z.number(),
		previous_total: z.number(),
		assistants: z.array(z.object({ name: z.string(), tokens: z.number() })),
		models: z.array(z.object({ name: z.string(), tokens: z.number() })),
	}),
	storage: z.object({
		used_bytes: z.number().int(),
		quota_bytes: z.number().int(),
		pouches: z.number().int(),
		top_accounts: z.array(
			z.object({ user_id: z.string(), email: z.string(), used_bytes: z.number().int() }),
		),
	}),
});

export const AdminPayment = z.object({
	id: z.string(),
	user_id: z.string().nullable(),
	email: z.string().nullable(),
	plan_slug: z.string().nullable(),
	status: z.string(),
	currency: z.string(),
	amount_cents: z.number().int(),
	net_cents: z.number().int(),
	tax_cents: z.number().int(),
	refunded_cents: z.number().int(),
	created_at: Timestamp,
});

export const AdminPaymentQuery = z.object({
	cursor: z.string().max(200).optional(),
	limit: z.coerce.number().int().min(1).max(200).default(50),
});
