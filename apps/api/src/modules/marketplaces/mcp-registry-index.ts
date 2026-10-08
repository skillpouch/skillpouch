// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A copy of the MCP Registry in Postgres, because its own search takes
 * 10–30 s while listing is fast. The first sync reads every server (several
 * minutes, resumable); later ones read only what changed since. Only active
 * servers SkillPouch can run are kept. A lease lets one process sync at a
 * time; every process searches the table. Until the first sync finishes,
 * callers fall back to the registry's search.
 */
import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import type { Logger } from 'pino';
import type { Databases } from '../../infra/db';
import { rows } from '../../jobs/sql';
import {
	shortServerName,
	toServerConfig,
	type McpRegistryClient,
	type RegistryEntry,
	type RegistryServer,
} from './mcp-registry';

const REFRESH_MS = 10 * 60_000;
/** A failed or blocked sync retries sooner than the regular refresh. */
const RETRY_MS = 60_000;
const PAGE_ATTEMPTS = 3;
/** Long enough for one page with all its retries; renewed after every page. */
const LEASE = '5 minutes';
/** Changes made while a sync runs are read again by the next one. */
const OVERLAP_MS = 5 * 60_000;
const READY_CACHE_MS = 30_000;

interface SyncState {
	synced_since: string | null;
	crawl_cursor: string | null;
	crawl_started: string | null;
}

const escapeLike = (text: string) => text.replace(/[\\%_]/g, '\\$&');

export class McpRegistryIndex {
	private readonly owner = randomUUID();
	private readyUntil = 0;
	private syncing: Promise<boolean> | null = null;

	constructor(
		private readonly client: McpRegistryClient,
		private readonly db: Pick<Databases, 'app' | 'maintenance'>,
		private readonly now: () => Date = () => new Date(),
	) {}

	/** Whether the first full read has finished. */
	async ready(): Promise<boolean> {
		if (this.readyUntil > Date.now()) return true;
		const [state] = rows<{ ready: boolean }>(
			await this.db.app.execute(
				sql`SELECT synced_since IS NOT NULL AS ready FROM mcp_registry_sync`,
			),
		);
		if (state?.ready) this.readyUntil = Date.now() + READY_CACHE_MS;
		return state?.ready ?? false;
	}

	/** Servers matching every word of `query`, best name matches first; all when empty. */
	async search(
		query: string,
		offset: number,
		limit: number,
	): Promise<{ servers: RegistryServer[]; total: number }> {
		const q = query.trim().toLowerCase();
		const patterns = q
			.split(/\s+/)
			.filter(Boolean)
			.map((word) => `%${escapeLike(word)}%`);
		const found = rows<{ server: RegistryServer; total: number }>(
			await this.db.app.execute(sql`
				SELECT server, count(*) OVER ()::int AS total
				FROM mcp_registry_servers
				WHERE search_text LIKE ALL (${sql.param(patterns)}::text[])
				ORDER BY
					CASE
						WHEN short_name = ${q} THEN 0
						WHEN short_name LIKE ${`${escapeLike(q)}%`} THEN 1
						WHEN lower(name) LIKE ALL (${sql.param(patterns)}::text[]) THEN 2
						ELSE 3
					END,
					name
				LIMIT ${limit} OFFSET ${offset}`),
		);
		if (found.length > 0) {
			return { servers: found.map((row) => row.server), total: found[0]!.total };
		}
		if (offset === 0) return { servers: [], total: 0 };
		const [count] = rows<{ total: number }>(
			await this.db.app.execute(sql`
				SELECT count(*)::int AS total FROM mcp_registry_servers
				WHERE search_text LIKE ALL (${sql.param(patterns)}::text[])`),
		);
		return { servers: [], total: count?.total ?? 0 };
	}

	async get(name: string): Promise<RegistryServer | undefined> {
		const [row] = rows<{ server: RegistryServer }>(
			await this.db.app.execute(
				sql`SELECT server FROM mcp_registry_servers WHERE name = ${name}`,
			),
		);
		return row?.server;
	}

	/**
	 * Reads every server the first time, then only changes. False when another
	 * process holds the lease. One sync at a time per process.
	 */
	sync(): Promise<boolean> {
		this.syncing ??= this.read().finally(() => {
			this.syncing = null;
		});
		return this.syncing;
	}

	/** Syncs now and every 10 minutes; returns a stop function. */
	start(log: Logger): () => void {
		let timer: NodeJS.Timeout | undefined;
		let stopped = false;
		const run = async () => {
			const started = Date.now();
			let wait = RETRY_MS;
			try {
				if (await this.sync()) {
					wait = REFRESH_MS;
					log.info({ ms: Date.now() - started }, 'mcp registry synced');
				}
			} catch (error) {
				log.warn({ err: error }, 'mcp registry sync failed');
			}
			if (stopped) return;
			timer = setTimeout(() => void run(), wait);
			timer.unref();
		};
		void run();
		return () => {
			stopped = true;
			clearTimeout(timer);
		};
	}

	private async read(): Promise<boolean> {
		const state = await this.takeLease();
		if (!state) return false;
		try {
			if (state.synced_since) {
				const startedAt = this.now();
				let cursor: string | undefined;
				do {
					const page = await this.page(
						cursor,
						new Date(state.synced_since).toISOString(),
					);
					await this.store(page.entries);
					cursor = page.nextCursor ?? undefined;
					await this.renewLease();
				} while (cursor);
				await this.finish(startedAt);
				return true;
			}

			const startedAt = state.crawl_started ? new Date(state.crawl_started) : this.now();
			let cursor = state.crawl_cursor ?? undefined;
			do {
				const page = await this.page(cursor);
				await this.store(page.entries);
				cursor = page.nextCursor ?? undefined;
				await this.db.maintenance.execute(sql`
					UPDATE mcp_registry_sync
					SET crawl_cursor = ${cursor ?? null},
						crawl_started = ${startedAt.toISOString()}::timestamptz,
						lease_until = now() + ${LEASE}::interval
					WHERE lease_owner = ${this.owner}`);
			} while (cursor);
			await this.finish(startedAt);
			return true;
		} finally {
			await this.db.maintenance.execute(sql`
				UPDATE mcp_registry_sync SET lease_owner = NULL, lease_until = NULL
				WHERE lease_owner = ${this.owner}`);
		}
	}

	private async takeLease(): Promise<SyncState | undefined> {
		const [state] = rows<SyncState>(
			await this.db.maintenance.execute(sql`
				UPDATE mcp_registry_sync
				SET lease_owner = ${this.owner}, lease_until = now() + ${LEASE}::interval
				WHERE lease_until IS NULL OR lease_until < now() OR lease_owner = ${this.owner}
				RETURNING synced_since::text, crawl_cursor, crawl_started::text`),
		);
		return state;
	}

	private async renewLease(): Promise<void> {
		await this.db.maintenance.execute(sql`
			UPDATE mcp_registry_sync SET lease_until = now() + ${LEASE}::interval
			WHERE lease_owner = ${this.owner}`);
	}

	private async finish(startedAt: Date): Promise<void> {
		const since = new Date(startedAt.getTime() - OVERLAP_MS).toISOString();
		await this.db.maintenance.execute(sql`
			UPDATE mcp_registry_sync
			SET synced_since = ${since}::timestamptz, crawl_cursor = NULL, crawl_started = NULL
			WHERE lease_owner = ${this.owner}`);
		this.readyUntil = Date.now() + READY_CACHE_MS;
	}

	private async page(cursor: string | undefined, since?: string) {
		for (let attempt = 1; ; attempt++) {
			try {
				return await this.client.listPage(cursor, since);
			} catch (error) {
				if (attempt >= PAGE_ATTEMPTS) throw error;
			}
		}
	}

	/** Upserts active servers that can run; deletes the rest. */
	private async store(entries: RegistryEntry[]): Promise<void> {
		const keep = new Map<string, object>();
		const drop = new Set<string>();
		for (const { server, status } of entries) {
			if (status === 'active' && toServerConfig(server) !== null) {
				const short = shortServerName(server.name);
				keep.set(server.name, {
					name: server.name,
					short_name: short,
					server,
					search_text:
						`${server.name} ${short} ${server.description ?? ''}`.toLowerCase(),
				});
				drop.delete(server.name);
			} else {
				keep.delete(server.name);
				drop.add(server.name);
			}
		}
		if (keep.size > 0) {
			await this.db.maintenance.execute(sql`
				INSERT INTO mcp_registry_servers (name, short_name, server, search_text)
				SELECT name, short_name, server, search_text
				FROM jsonb_to_recordset(${JSON.stringify([...keep.values()])}::jsonb)
					AS r (name text, short_name text, server jsonb, search_text text)
				ON CONFLICT (name) DO UPDATE SET
					short_name = EXCLUDED.short_name,
					server = EXCLUDED.server,
					search_text = EXCLUDED.search_text,
					updated_at = now()`);
		}
		if (drop.size > 0) {
			await this.db.maintenance.execute(
				sql`DELETE FROM mcp_registry_servers WHERE name = ANY (${sql.param([...drop])}::text[])`,
			);
		}
	}
}
