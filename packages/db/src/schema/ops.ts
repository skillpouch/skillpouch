// SPDX-License-Identifier: AGPL-3.0-only
/** Operational tables: rate limits, audit log, security events, settings (03 §5.14). */
import { doublePrecision, jsonb, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { bytea, tstz } from './columns';

export const rateLimits = pgTable('rate_limits', {
	key: text('key').primaryKey(),
	tokens: doublePrecision('tokens').notNull(),
	refilledAt: tstz('refilled_at').notNull(),
});

export const auditLog = pgTable('audit_log', {
	id: uuid('id').primaryKey().defaultRandom(),
	storageAccountId: uuid('storage_account_id'),
	actor: text('actor').notNull(),
	action: text('action').notNull(),
	target: text('target'),
	details: jsonb('details').$type<Record<string, unknown>>().notNull().default({}),
	ipHash: bytea('ip_hash'),
	prevHash: bytea('prev_hash'),
	rowHash: bytea('row_hash').notNull(),
	createdAt: tstz('created_at').notNull().defaultNow(),
});

export const securityEvents = pgTable('security_events', {
	id: uuid('id').primaryKey().defaultRandom(),
	storageAccountId: uuid('storage_account_id').notNull(),
	kind: text('kind').notNull(),
	severity: text('severity', { enum: ['info', 'warning', 'critical'] }).notNull(),
	details: jsonb('details').$type<Record<string, unknown>>().notNull().default({}),
	createdAt: tstz('created_at').notNull().defaultNow(),
	acknowledgedAt: tstz('acknowledged_at'),
});

export const systemSettings = pgTable('system_settings', {
	key: text('key').primaryKey(),
	value: jsonb('value').notNull(),
	updatedAt: tstz('updated_at').notNull().defaultNow(),
});
