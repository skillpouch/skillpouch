// SPDX-License-Identifier: AGPL-3.0-only
/** Marketplaces an account added, and its connected GitHub App installations. */
import { bigint, pgTable, primaryKey, text, uuid } from 'drizzle-orm/pg-core';
import { tenantColumn, tstz } from './columns';

export const marketplaces = pgTable('marketplaces', {
	id: uuid('id').primaryKey(),
	storageAccountId: tenantColumn(),
	/** GitHub `owner/name`. */
	repo: text('repo').notNull(),
	/** Set for private repositories: the installation that can read it. */
	installationId: bigint('installation_id', { mode: 'number' }),
	createdAt: tstz('created_at').notNull().defaultNow(),
});

export const githubInstallations = pgTable(
	'github_installations',
	{
		storageAccountId: tenantColumn(),
		installationId: bigint('installation_id', { mode: 'number' }).notNull(),
		accountLogin: text('account_login').notNull(),
		accountType: text('account_type', { enum: ['User', 'Organization'] }).notNull(),
		githubUserId: bigint('github_user_id', { mode: 'number' }).notNull(),
		createdAt: tstz('created_at').notNull().defaultNow(),
	},
	(t) => [primaryKey({ columns: [t.storageAccountId, t.installationId] })],
);
