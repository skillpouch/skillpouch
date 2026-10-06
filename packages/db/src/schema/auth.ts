// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Better Auth tables. Property names follow Better Auth's model
 * fields; column names are snake_case. Extra fields: users.role,
 * users.suspended_at, sessions.jkt, sessions.step_up_at.
 */
import { boolean, pgTable, text } from 'drizzle-orm/pg-core';
import { tstz } from './columns';

export const users = pgTable('users', {
	id: text('id').primaryKey(),
	name: text('name').notNull(),
	email: text('email').notNull().unique(),
	emailVerified: boolean('email_verified').notNull().default(false),
	image: text('image'),
	role: text('role', { enum: ['user', 'admin'] })
		.notNull()
		.default('user'),
	suspendedAt: tstz('suspended_at'),
	deletedAt: tstz('deleted_at'),
	createdAt: tstz('created_at').notNull().defaultNow(),
	updatedAt: tstz('updated_at').notNull().defaultNow(),
});

export const sessions = pgTable('sessions', {
	id: text('id').primaryKey(),
	token: text('token').notNull().unique(),
	userId: text('user_id')
		.notNull()
		.references(() => users.id, { onDelete: 'cascade' }),
	expiresAt: tstz('expires_at').notNull(),
	ipAddress: text('ip_address'),
	userAgent: text('user_agent'),
	jkt: text('jkt'),
	stepUpAt: tstz('step_up_at'),
	createdAt: tstz('created_at').notNull().defaultNow(),
	updatedAt: tstz('updated_at').notNull().defaultNow(),
});

export const accounts = pgTable('accounts', {
	id: text('id').primaryKey(),
	accountId: text('account_id').notNull(),
	providerId: text('provider_id').notNull(),
	userId: text('user_id')
		.notNull()
		.references(() => users.id, { onDelete: 'cascade' }),
	accessToken: text('access_token'),
	refreshToken: text('refresh_token'),
	idToken: text('id_token'),
	accessTokenExpiresAt: tstz('access_token_expires_at'),
	refreshTokenExpiresAt: tstz('refresh_token_expires_at'),
	scope: text('scope'),
	password: text('password'),
	createdAt: tstz('created_at').notNull().defaultNow(),
	updatedAt: tstz('updated_at').notNull().defaultNow(),
});

export const verifications = pgTable('verifications', {
	id: text('id').primaryKey(),
	identifier: text('identifier').notNull(),
	value: text('value').notNull(),
	expiresAt: tstz('expires_at').notNull(),
	createdAt: tstz('created_at').notNull().defaultNow(),
	updatedAt: tstz('updated_at').notNull().defaultNow(),
});
