// SPDX-License-Identifier: AGPL-3.0-only
import { afterEach, describe, expect, it } from 'vitest';
import type { Ingredient } from '../../ingredients/ingredients';
import {
	groupMarketplaces,
	installedLookup,
	itemFiles,
	kindCount,
	noun,
	offering,
	parseRepoInput,
	repositoryOffer,
	safeItemName,
	startGithubConnect,
	takeGithubReturn,
	type Marketplace,
	type MarketplaceItem,
	type RepositoryView,
} from '../marketplaces';

const marketplace = (id: string, kinds: Marketplace['kinds']): Marketplace => ({
	id,
	source: 'github',
	name: id,
	description: null,
	repo: null,
	private: false,
	builtin: true,
	url: '',
	kinds,
});

const b64 = (text: string) => btoa(text);

describe('safeItemName', () => {
	it('keeps valid names and cleans the rest', () => {
		expect(safeItemName('pdf-tools', 'skill')).toBe('pdf-tools');
		expect(safeItemName('My Skill!', 'skill')).toBe('My-Skill');
		expect(safeItemName('@scope/pkg', 'skill')).toBe('scope-pkg');
		expect(safeItemName('!!!', 'mcp-server')).toBe('mcp-server');
		expect(safeItemName('a'.repeat(80), 'skill')).toHaveLength(64);
	});
});

describe('itemFiles', () => {
	it('makes an instructions file the pouch instructions', () => {
		const files = itemFiles({
			kind: 'instructions',
			name: 'AGENTS.md',
			description: null,
			files: [{ path: 'AGENTS.md', size: 2, content_b64: b64('hi') }],
			truncated: false,
			url: '',
		});
		expect(files.map((file) => file.path)).toEqual(['INSTRUCTIONS.md']);
		expect(new TextDecoder().decode(files[0]!.bytes)).toBe('hi');
	});

	it('keeps paths of other kinds', () => {
		const files = itemFiles({
			kind: 'skill',
			name: 'pdf',
			description: null,
			files: [
				{ path: 'SKILL.md', size: 1, content_b64: b64('a') },
				{ path: 'scripts/x.py', size: 1, content_b64: b64('b') },
			],
			truncated: false,
			url: '',
		});
		expect(files.map((file) => file.path)).toEqual(['SKILL.md', 'scripts/x.py']);
	});
});

describe('installedLookup', () => {
	const ingredient = (kind: Ingredient['kind'], name: string, extra: Partial<Ingredient> = {}) =>
		({ id: name, kind, name, scope: 'global', deleted: false, ...extra }) as Ingredient;
	const installed = installedLookup([
		ingredient('skill', 'pdf-tools'),
		ingredient('skill', 'gone', { deleted: true }),
		ingredient('mcp_server', 'blender'),
		ingredient('instructions', 'instructions'),
	]);

	it('matches by kind and the name the item gets in a pouch, ignoring case', () => {
		expect(installed({ kind: 'skill', name: 'PDF tools' })?.id).toBe('pdf-tools');
		expect(installed({ kind: 'mcp_server', name: 'blender' })?.id).toBe('blender');
		expect(installed({ kind: 'agent', name: 'pdf-tools' })).toBeUndefined();
	});

	it('ignores deleted items and kinds kept as one per pouch', () => {
		expect(installed({ kind: 'skill', name: 'gone' })).toBeUndefined();
		expect(installed({ kind: 'instructions', name: 'instructions' })).toBeUndefined();
	});
});

describe('offering', () => {
	it('filters marketplaces by kind', () => {
		const all = [marketplace('a', ['skill']), marketplace('b', ['mcp_server'])];
		expect(offering(all, 'mcp_server').map((entry) => entry.id)).toEqual(['b']);
		expect(offering(all)).toHaveLength(2);
	});
});

describe('groupMarketplaces', () => {
	const all: Marketplace[] = [
		{ ...marketplace('skills-sh', ['skill']), source: 'skills_sh', name: 'skills.sh' },
		{
			...marketplace('anthropic', ['skill']),
			name: 'Anthropic Skills',
			repo: 'anthropics/skills',
		},
		{
			...marketplace('mine', ['skill']),
			name: 'team-skills',
			repo: 'acme/team-skills',
			builtin: false,
			private: true,
		},
	];
	const ids = (groups: ReturnType<typeof groupMarketplaces>) =>
		groups.map((group) => [group.id, group.marketplaces.map((entry) => entry.id)]);

	it('splits directories, featured repositories and the account’s own', () => {
		expect(ids(groupMarketplaces(all))).toEqual([
			['directories', ['skills-sh']],
			['featured', ['anthropic']],
			['yours', ['mine']],
		]);
	});

	it('filters by name or repository and drops empty groups', () => {
		expect(ids(groupMarketplaces(all, 'ACME'))).toEqual([['yours', ['mine']]]);
		expect(groupMarketplaces(all, 'nothing')).toEqual([]);
	});
});

describe('parseRepoInput', () => {
	it('reads owner/name from what people type or paste', () => {
		expect(parseRepoInput('anthropics/skills')).toBe('anthropics/skills');
		expect(parseRepoInput(' https://github.com/vercel-labs/agent-skills ')).toBe(
			'vercel-labs/agent-skills',
		);
		expect(parseRepoInput('github.com/acme/tools.git')).toBe('acme/tools');
		expect(parseRepoInput('https://github.com/acme/tools/tree/main/skills/pdf')).toBe(
			'acme/tools',
		);
		expect(parseRepoInput('git@github.com:acme/tools.git')).toBe('acme/tools');
	});

	it('is null until it looks like a repository', () => {
		expect(parseRepoInput('')).toBeNull();
		expect(parseRepoInput('acme')).toBeNull();
		expect(parseRepoInput('acme/')).toBeNull();
		expect(parseRepoInput('https://gitlab.com/acme/tools')).toBeNull();
	});
});

describe('GitHub connect state', () => {
	afterEach(() => sessionStorage.clear());

	it('returns where we came from only for the state this tab sent', () => {
		const assign = window.location.assign;
		let sentTo = '';
		Object.defineProperty(window, 'location', {
			value: { ...window.location, assign: (url: string) => (sentTo = url) },
			configurable: true,
		});
		startGithubConnect(
			{
				available: true,
				install_url: 'https://github.com/apps/skillpouch/installations/new',
				authorize_url: null,
				connections: [],
			},
			'/app/p/1/marketplaces',
		);
		const state = new URL(sentTo).searchParams.get('state');
		expect(takeGithubReturn('forged')).toBeNull();
		startGithubConnect(
			{
				available: true,
				install_url: 'https://github.com/apps/skillpouch/installations/new',
				authorize_url: null,
				connections: [],
			},
			'/app/p/1/marketplaces',
		);
		const fresh = new URL(sentTo).searchParams.get('state');
		expect(state).not.toBe(fresh);
		expect(takeGithubReturn(fresh)).toBe('/app/p/1/marketplaces');
		expect(takeGithubReturn(fresh)).toBeNull();
		Object.defineProperty(window, 'location', { value: { ...window.location, assign } });
	});
});

describe('repositoryOffer', () => {
	const item = (kind: MarketplaceItem['kind'], name: string): MarketplaceItem => ({
		key: name,
		kind,
		name,
		description: null,
		repo: 'acme/tools',
		installs: null,
	});
	const repository = (items: MarketplaceItem[], hasManifest = false): RepositoryView => ({
		repo: 'acme/tools',
		private: false,
		url: 'https://github.com/acme/tools',
		marketplace_id: null,
		has_manifest: hasManifest,
		items,
	});

	it('offers the one item a repository is, even beside its own AGENTS.md', () => {
		const pdf = item('skill', 'pdf');
		expect(repositoryOffer(repository([pdf, item('instructions', 'AGENTS')]), 'skill')).toEqual(
			{ type: 'item', item: pdf },
		);
	});

	it('treats several of a kind, or a marketplace manifest, as a marketplace', () => {
		const two = repository([item('skill', 'pdf'), item('skill', 'docx')]);
		expect(repositoryOffer(two, 'skill')).toEqual({ type: 'marketplace', count: 2 });
		const listed = repository([item('skill', 'pdf'), item('agent', 'reviewer')], true);
		expect(repositoryOffer(listed, 'skill')).toEqual({ type: 'marketplace', count: 1 });
	});

	it('says what else a repository holds when it has none of the kind', () => {
		const agents = repository([
			item('agent', 'a'),
			item('agent', 'b'),
			item('mcp_server', 'gh'),
		]);
		expect(repositoryOffer(agents, 'skill')).toEqual({
			type: 'none',
			others: [
				{ kind: 'agent', count: 2 },
				{ kind: 'mcp_server', count: 1 },
			],
		});
		expect(repositoryOffer(repository([]), 'skill')).toEqual({ type: 'none', others: [] });
	});
});

describe('kindCount', () => {
	it('counts in running text and keeps acronyms', () => {
		expect(kindCount('skill', 1)).toBe('1 skill');
		expect(kindCount('skill', 12)).toBe('12 skills');
		expect(kindCount('mcp_server', 2)).toBe('2 MCP servers');
		expect(noun('MCP server')).toBe('MCP server');
		expect(noun('Agent')).toBe('agent');
	});
});
