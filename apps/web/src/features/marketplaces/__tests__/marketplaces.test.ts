// SPDX-License-Identifier: AGPL-3.0-only
import { afterEach, describe, expect, it } from 'vitest';
import {
	groupMarketplaces,
	itemFiles,
	offering,
	parseRepoInput,
	safeItemName,
	startGithubConnect,
	takeGithubReturn,
	type Marketplace,
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
