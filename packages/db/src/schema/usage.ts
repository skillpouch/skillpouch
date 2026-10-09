// SPDX-License-Identifier: AGPL-3.0-only
/** Tokens the account's AI assistants used, per day, as each computer counted them. */
import { date, pgTable, primaryKey, text, uuid } from 'drizzle-orm/pg-core';
import { int8, tenantColumn, tstz } from './columns';

export const tokenUsage = pgTable(
	'token_usage',
	{
		storageAccountId: tenantColumn(),
		/** The logs the counts come from: one per computer and OS user, kept across logins. */
		sourceId: text('source_id').notNull(),
		day: date('day', { mode: 'string' }).notNull(),
		assistant: text('assistant').notNull(),
		model: text('model').notNull(),
		inputTokens: int8('input_tokens').notNull(),
		outputTokens: int8('output_tokens').notNull(),
		cacheReadTokens: int8('cache_read_tokens').notNull(),
		cacheWriteTokens: int8('cache_write_tokens').notNull(),
		/** The device that last reported these counts. */
		deviceId: uuid('device_id'),
		updatedAt: tstz('updated_at').notNull().defaultNow(),
	},
	(t) => [primaryKey({ columns: [t.storageAccountId, t.sourceId, t.day, t.assistant, t.model] })],
);
