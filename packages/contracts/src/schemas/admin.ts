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
