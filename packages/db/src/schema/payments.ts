// SPDX-License-Identifier: AGPL-3.0-only
/** Charges copied from the billing provider, for the admin dashboard's earnings. */
import { integer, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { plans, storageAccounts } from './accounts';
import { tstz } from './columns';

export const payments = pgTable('payments', {
	/** The provider's order id. */
	id: text('id').primaryKey(),
	provider: text('provider').notNull(),
	storageAccountId: uuid('storage_account_id').references(() => storageAccounts.id),
	planId: uuid('plan_id').references(() => plans.id),
	status: text('status').notNull(),
	currency: text('currency').notNull(),
	amountCents: integer('amount_cents').notNull(),
	/** After discounts, before tax. */
	netCents: integer('net_cents').notNull(),
	taxCents: integer('tax_cents').notNull().default(0),
	refundedCents: integer('refunded_cents').notNull().default(0),
	createdAt: tstz('created_at').notNull(),
	updatedAt: tstz('updated_at').notNull().defaultNow(),
});
