// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import type { DeviceList } from '@/features/devices/devices';
import type { Ingredient } from '@/features/ingredients/ingredients';
import type { Project } from '@/features/projects/projects';
import type { Invoice } from '@/lib/api/types';
import { searchEverything, type SearchSources } from '../search-index';

const item = (id: string, kind: string, name: string, scope = 'global') =>
	({ id, kind, name, scope, deleted: false }) as unknown as Ingredient;

const project = { id: 'prj1', name: 'web-app', description: 'storefront' } as Project;

const devices = {
	devices: [
		{ id: 'd1', name: 'work-laptop', os: 'linux', assistants: ['claude'], state: 'active' },
		{ id: 'd2', name: 'stolen-laptop', os: 'macos', assistants: [], state: 'revoked' },
	],
	browsers: [{ member_id: 'b1', revoked_at: null, removed_seq: null, is_current: false }],
} as unknown as DeviceList;

const invoices = [
	{
		id: 'ord1',
		created_at: '2026-10-08T00:00:00Z',
		description: 'Supporter',
		amount_cents: 500,
		currency: 'usd',
		status: 'paid',
	},
] as Invoice[];

const sources: SearchSources = {
	pouch: {
		id: 'p1',
		ingredients: [
			item('i1', 'skill', 'pdf-tools'),
			item('i2', 'mcp_server', 'postgres'),
			item('i3', 'instructions', 'AGENTS.md', 'project:prj1'),
		],
		projects: [project],
	},
	pouches: [
		{ id: 'p1', name: 'Work', description: '', state: 'active' },
		{ id: 'p2', name: 'Personal', description: 'home setup', state: 'active' },
		{ id: 'p3', name: 'Old', description: '', state: 'deleted' },
	],
	devices,
	invoices,
};

const labels = (text: string, input = sources) =>
	searchEverything(input, text).map((result) => result.label);

describe('searchEverything', () => {
	it('finds items, linking project items into their project', () => {
		const [pdf] = searchEverything(sources, 'pdf');
		expect(pdf).toMatchObject({ group: 'Items', href: '/app/p/p1/skills?item=i1' });
		const [agents] = searchEverything(sources, 'agents.md');
		expect(agents).toMatchObject({ hint: 'Instructions · web-app' });
		expect(agents!.href).toBe('/app/p/p1/projects/prj1?kind=instructions&item=i3');
	});

	it('finds devices, browsers and invoices, but not revoked devices', () => {
		expect(labels('laptop')).toEqual(['work-laptop']);
		expect(searchEverything(sources, 'browser')).toContainEqual(
			expect.objectContaining({ group: 'Browsers', href: '/app/account/devices' }),
		);
		expect(searchEverything(sources, 'invoice')).toContainEqual(
			expect.objectContaining({ group: 'Invoices', href: '/app/account/billing' }),
		);
	});

	it('finds account pages by what is on them', () => {
		expect(labels('recovery key')).toEqual(['Security']);
		expect(labels('subscription')).toContain('Billing');
	});

	it('lists other pouches, not the open or deleted ones', () => {
		expect(labels('setup')).toEqual(['Personal']);
		expect(labels('work')).toEqual(['work-laptop']);
		expect(labels('old')).toEqual([]);
	});

	it('works outside a pouch, without pouch pages', () => {
		const { pouch: _, ...outside } = sources;
		expect(labels('pdf', outside)).toEqual([]);
		expect(labels('overview', outside)).toEqual([]);
		expect(labels('work', outside)).toEqual(['Work', 'work-laptop']);
	});

	it('ranks labels starting with the query first', () => {
		const settings = searchEverything(sources, 'settings').map((result) => result.label);
		expect(settings[0]).toBe('Pouch settings');
	});

	it('shows pages and a few items when the query is empty, in group order', () => {
		const idle = searchEverything(sources, '');
		const groups = [...new Set(idle.map((result) => result.group))];
		expect(groups).toEqual(['Items', 'Pouches', 'Pages']);
	});
});
