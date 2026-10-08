// SPDX-License-Identifier: AGPL-3.0-only
/** The searchable copy of the official MCP Registry and its sync state. */
import { jsonb, pgTable, smallint, text } from 'drizzle-orm/pg-core';
import { tstz } from './columns';

export const mcpRegistryServers = pgTable('mcp_registry_servers', {
	name: text('name').primaryKey(),
	shortName: text('short_name').notNull(),
	server: jsonb('server').notNull(),
	/** Lowercased name, short name and description. */
	searchText: text('search_text').notNull(),
	updatedAt: tstz('updated_at').notNull().defaultNow(),
});

export const mcpRegistrySync = pgTable('mcp_registry_sync', {
	id: smallint('id').primaryKey().default(1),
	/** Changes since this time are read next; null until the first full read finishes. */
	syncedSince: tstz('synced_since'),
	crawlCursor: text('crawl_cursor'),
	crawlStarted: tstz('crawl_started'),
	leaseOwner: text('lease_owner'),
	leaseUntil: tstz('lease_until'),
});
