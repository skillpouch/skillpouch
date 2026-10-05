// SPDX-License-Identifier: AGPL-3.0-only
/** Storage accounts, plans, entitlements and billing (03 §5.2, 09, 18). */
import { boolean, integer, jsonb, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { bytea, int8, tstz } from './columns';
import { users } from './auth';

/** Cached effective entitlements (18 §3.3). */
export interface EntitlementsJson {
	plan_slug: string;
	plan_name: string;
	source: 'default' | 'subscription' | 'grant' | 'override';
	pouch_limit: number;
	storage_bytes: number;
}

export const storageAccounts = pgTable('storage_accounts', {
	id: uuid('id').primaryKey(),
	ownerUserId: text('owner_user_id')
		.notNull()
		.unique()
		.references(() => users.id),
	entitlements: jsonb('entitlements').$type<EntitlementsJson>().notNull(),
	quotaBytes: int8('quota_bytes').notNull(),
	usedBytes: int8('used_bytes').notNull().default(0),
	pendingBytes: int8('pending_bytes').notNull().default(0),
	overQuotaSince: tstz('over_quota_since'),
	securitySettings: jsonb('security_settings')
		.$type<Record<string, unknown>>()
		.notNull()
		.default({}),
	genesisHash: bytea('genesis_hash'),
	rosterSeq: int8('roster_seq').notNull().default(0),
	rosterHeadHash: bytea('roster_head_hash'),
	deleteAfter: tstz('delete_after'),
	resetAfter: tstz('reset_after'),
	createdAt: tstz('created_at').notNull().defaultNow(),
	updatedAt: tstz('updated_at').notNull().defaultNow(),
});

export const plans = pgTable('plans', {
	id: uuid('id').primaryKey().defaultRandom(),
	slug: text('slug').notNull().unique(),
	name: text('name').notNull(),
	description: text('description').notNull().default(''),
	priceCents: integer('price_cents').notNull().default(0),
	currency: text('currency').notNull().default('usd'),
	interval: text('interval', { enum: ['month', 'year'] }),
	pouchLimit: integer('pouch_limit').notNull(),
	storageBytes: int8('storage_bytes').notNull(),
	polarProductId: text('polar_product_id').unique(),
	isDefault: boolean('is_default').notNull().default(false),
	isPublic: boolean('is_public').notNull().default(true),
	isActive: boolean('is_active').notNull().default(true),
	sort: integer('sort').notNull().default(0),
	createdAt: tstz('created_at').notNull().defaultNow(),
	updatedAt: tstz('updated_at').notNull().defaultNow(),
});

export const planGrants = pgTable('plan_grants', {
	id: uuid('id').primaryKey().defaultRandom(),
	storageAccountId: uuid('storage_account_id')
		.notNull()
		.references(() => storageAccounts.id),
	planId: uuid('plan_id')
		.notNull()
		.references(() => plans.id),
	startsAt: tstz('starts_at').notNull().defaultNow(),
	endsAt: tstz('ends_at'),
	reason: text('reason').notNull(),
	grantedBy: text('granted_by')
		.notNull()
		.references(() => users.id),
	revokedAt: tstz('revoked_at'),
	createdAt: tstz('created_at').notNull().defaultNow(),
});

export const entitlementOverrides = pgTable('entitlement_overrides', {
	storageAccountId: uuid('storage_account_id')
		.primaryKey()
		.references(() => storageAccounts.id),
	pouchLimit: integer('pouch_limit'),
	storageBytes: int8('storage_bytes'),
	expiresAt: tstz('expires_at'),
	note: text('note').notNull().default(''),
	updatedBy: text('updated_by')
		.notNull()
		.references(() => users.id),
	updatedAt: tstz('updated_at').notNull().defaultNow(),
});

export const subscriptions = pgTable('subscriptions', {
	id: uuid('id').primaryKey().defaultRandom(),
	storageAccountId: uuid('storage_account_id')
		.notNull()
		.references(() => storageAccounts.id),
	planId: uuid('plan_id').references(() => plans.id),
	provider: text('provider').notNull(),
	externalCustomerId: text('external_customer_id').notNull(),
	externalSubscriptionId: text('external_subscription_id').notNull().unique(),
	status: text('status').notNull(),
	interval: text('interval'),
	amountCents: integer('amount_cents').notNull().default(0),
	currentPeriodEnd: tstz('current_period_end'),
	cancelAtPeriodEnd: boolean('cancel_at_period_end').notNull().default(false),
	updatedAt: tstz('updated_at').notNull().defaultNow(),
});

export const billingEvents = pgTable('billing_events', {
	provider: text('provider').notNull(),
	externalId: text('external_id').notNull(),
	type: text('type').notNull(),
	payload: jsonb('payload').notNull(),
	processedAt: tstz('processed_at'),
	createdAt: tstz('created_at').notNull().defaultNow(),
});
