// SPDX-License-Identifier: AGPL-3.0-only
/** The MCP Registry copy in Postgres: full, resumed and incremental syncs, the lease, ranking. */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { McpRegistryClient } from '../../src/modules/marketplaces/mcp-registry';
import { McpRegistryIndex } from '../../src/modules/marketplaces/mcp-registry-index';
import { createHarness, type Harness } from '../helpers/harness';

const server = (name: string, description = '') => ({
	name,
	description,
	packages: [{ registryType: 'npm', identifier: `@x/${name.split('/')[1]}` }],
});

const entry = (value: object, status = 'active') => ({
	server: value,
	_meta: { 'io.modelcontextprotocol.registry/official': { status } },
});

const fullList: Record<string, object> = {
	first: {
		servers: [
			entry(server('io.github.a/blender-mcp', 'Control Blender')),
			entry(server('io.github.b/scene', 'A blender scene helper')),
			entry({ name: 'io.github.c/remote-only' }),
		],
		metadata: { nextCursor: 'two' },
	},
	two: {
		servers: [
			entry(server('io.github.d/blender', 'Blender 100%_done')),
			entry(server('io.github.e/gone'), 'deleted'),
		],
	},
};

function fakeRegistry(pages: Record<string, object>, failing: (url: URL) => boolean = () => false) {
	const requests: URL[] = [];
	const http: typeof fetch = async (input) => {
		const url = new URL(String(input));
		requests.push(url);
		if (failing(url)) return new Response('busy', { status: 503 });
		const key = url.searchParams.get('updated_since')
			? 'changes'
			: (url.searchParams.get('cursor') ?? 'first');
		return Response.json(pages[key] ?? { servers: [] });
	};
	return { http, requests };
}

describe('McpRegistryIndex', () => {
	let h: Harness;
	const index = (http: typeof fetch, now?: () => Date) =>
		new McpRegistryIndex(new McpRegistryClient(http), h.deps.db, now);

	beforeAll(async () => {
		h = await createHarness();
	});
	afterAll(async () => {
		await h.close();
	});
	beforeEach(async () => {
		await h.owner.query('DELETE FROM mcp_registry_servers');
		await h.owner.query(
			'UPDATE mcp_registry_sync SET synced_since = NULL, crawl_cursor = NULL, crawl_started = NULL, lease_owner = NULL, lease_until = NULL',
		);
	});

	const names = (servers: { name: string }[]) => servers.map((entry) => entry.name);

	it('reads every page, keeping only active servers that can run', async () => {
		const copy = index(fakeRegistry(fullList).http);
		expect(await copy.ready()).toBe(false);
		expect(await copy.sync()).toBe(true);
		expect(await copy.ready()).toBe(true);
		const all = await copy.search('', 0, 30);
		expect(all.total).toBe(3);
		expect(await copy.get('io.github.c/remote-only')).toBeUndefined();
		expect(await copy.get('io.github.a/blender-mcp')).toMatchObject({
			description: 'Control Blender',
		});
	});

	it('ranks exact and prefix name matches first and pages with a total', async () => {
		const copy = index(fakeRegistry(fullList).http);
		await copy.sync();
		expect(names((await copy.search('Blender', 0, 30)).servers)).toEqual([
			'io.github.d/blender',
			'io.github.a/blender-mcp',
			'io.github.b/scene',
		]);
		expect(names((await copy.search('blender scene', 0, 30)).servers)).toEqual([
			'io.github.b/scene',
		]);
		expect(await copy.search('blender', 2, 2)).toMatchObject({ total: 3 });
		expect(await copy.search('blender', 5, 2)).toEqual({ servers: [], total: 3 });
		expect((await copy.search('100%_', 0, 30)).total).toBe(1);
		expect((await copy.search('0%', 0, 30)).total).toBe(1);
		expect((await copy.search('%', 0, 30)).total).toBe(1);
	});

	it('then reads only changes, dropping deleted servers', async () => {
		const { http, requests } = fakeRegistry({
			...fullList,
			changes: {
				servers: [
					entry(server('io.github.a/blender-mcp'), 'deleted'),
					entry(server('io.github.f/new')),
				],
			},
		});
		const copy = index(http, () => new Date('2026-10-08T12:00:00Z'));
		await copy.sync();
		await copy.sync();
		expect(requests.at(-1)?.searchParams.get('updated_since')).toBe('2026-10-08T11:55:00.000Z');
		expect(await copy.get('io.github.a/blender-mcp')).toBeUndefined();
		expect(await copy.get('io.github.f/new')).toBeDefined();
	});

	it('resumes an interrupted first read where it stopped', async () => {
		let down = true;
		const { http, requests } = fakeRegistry(
			fullList,
			(url) => down && url.searchParams.get('cursor') === 'two',
		);
		const copy = index(http);
		await expect(copy.sync()).rejects.toThrow();
		expect(await copy.ready()).toBe(false);
		down = false;
		requests.length = 0;
		expect(await copy.sync()).toBe(true);
		expect(requests.map((url) => url.searchParams.get('cursor'))).toEqual(['two']);
		expect((await copy.search('', 0, 30)).total).toBe(3);
	});

	it('lets one process sync at a time and shares a sync between callers', async () => {
		const first = index(fakeRegistry(fullList).http);
		const { http, requests } = fakeRegistry(fullList);
		const second = index(http);
		await h.owner.query(
			"UPDATE mcp_registry_sync SET lease_owner = 'other', lease_until = now() + interval '1 minute'",
		);
		expect(await first.sync()).toBe(false);
		await h.owner.query('UPDATE mcp_registry_sync SET lease_owner = NULL, lease_until = NULL');
		const [a, b] = await Promise.all([second.sync(), second.sync()]);
		expect([a, b]).toEqual([true, true]);
		expect(requests).toHaveLength(2);
	});
});
