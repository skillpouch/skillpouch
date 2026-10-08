// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Marketplaces against fake GitHub, skills.sh and MCP Registry: built-ins,
 * added public and private repositories, and connecting the GitHub App — which
 * keeps only installations GitHub lists for the authorizing user.
 */
import { generateKeyPairSync } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { GithubImporter } from '../../src/modules/import/github.service';
import { GithubApp } from '../../src/modules/marketplaces/github-app';
import { McpRegistryClient } from '../../src/modules/marketplaces/mcp-registry';
import { McpRegistryIndex } from '../../src/modules/marketplaces/mcp-registry-index';
import { SkillsShClient } from '../../src/modules/marketplaces/skills-sh';
import { setupAccount, type Account } from '../helpers/flows';
import { createHarness, type Harness } from '../helpers/harness';

const INSTALLATION_TOKEN = 'ghs_installation_11';

const json = (value: unknown, status = 200) =>
	new Response(JSON.stringify(value), {
		status,
		headers: { 'content-type': 'application/json' },
	});

const SKILL_MD = '---\nname: pdf\ndescription: Fill and merge PDF files\n---\n# PDF\n';

/** Public repo `acme/skills`, private `alice/secret` (installation 11 only). */
const fakeGithub: typeof fetch = async (input, init) => {
	const url = new URL(String(input));
	const auth = new Headers(init?.headers).get('authorization');
	const privateOk = auth === `Bearer ${INSTALLATION_TOKEN}`;
	if (url.host === 'raw.githubusercontent.com') {
		if (url.pathname.startsWith('/alice/')) return new Response('nope', { status: 404 });
		if (url.pathname.endsWith('/SKILL.md')) return new Response(SKILL_MD);
		if (url.pathname.endsWith('/.mcp.json')) {
			return json({ mcpServers: { github: { command: 'npx', args: ['gh-mcp'] } } });
		}
		return new Response(`content of ${url.pathname}`);
	}
	const path = url.pathname;
	if (path === '/repos/acme/skills') return json({ default_branch: 'main', private: false });
	if (path === '/repos/acme/skills/commits/main') return json({ sha: 'pub1' });
	if (path === '/repos/acme/skills/git/trees/pub1') {
		return json({
			tree: [
				{ path: 'pdf/SKILL.md', type: 'blob', size: 60 },
				{ path: 'pdf/scripts/fill.py', type: 'blob', size: 5 },
				{ path: 'agents/reviewer.md', type: 'blob', size: 5 },
				{ path: 'tools/.mcp.json', type: 'blob', size: 50 },
			],
		});
	}
	if (path.startsWith('/repos/alice/secret')) {
		if (!privateOk) return json({ message: 'Not Found' }, 404);
		if (path === '/repos/alice/secret') return json({ default_branch: 'main', private: true });
		if (path === '/repos/alice/secret/commits/main') return json({ sha: 'priv1' });
		if (path === '/repos/alice/secret/git/trees/priv1') {
			return json({ tree: [{ path: 'mine/SKILL.md', type: 'blob', size: 60 }] });
		}
		if (path === '/repos/alice/secret/contents/mine/SKILL.md') return new Response(SKILL_MD);
	}
	if (path.startsWith('/repos/')) return json({ message: 'Not Found' }, 404);
	return json({ message: 'unexpected' }, 500);
};

/** GitHub's OAuth and App endpoints for user 7 (`alice-gh`). */
const fakeGithubApp: typeof fetch = async (input) => {
	const url = new URL(String(input));
	if (url.pathname === '/login/oauth/access_token') {
		return json({ access_token: 'ghu_user' });
	}
	if (url.pathname === '/user') return json({ id: 7, login: 'alice-gh' });
	if (url.pathname === '/user/installations') {
		return json({
			installations: [
				{ id: 11, account: { login: 'alice-gh', id: 7, type: 'User' } },
				{ id: 12, account: { login: 'acme', id: 50, type: 'Organization' } },
				{ id: 13, account: { login: 'bigcorp', id: 51, type: 'Organization' } },
				{ id: 14, account: { login: 'mallory', id: 9, type: 'User' } },
			],
		});
	}
	if (url.pathname === '/user/memberships/orgs/acme') {
		return json({ role: 'admin', state: 'active' });
	}
	if (url.pathname === '/user/memberships/orgs/bigcorp') {
		return json({ role: 'member', state: 'active' });
	}
	if (url.pathname === '/app/installations/11/access_tokens') {
		return json({ token: INSTALLATION_TOKEN, expires_at: '2999-01-01T00:00:00Z' });
	}
	if (url.pathname === '/installation/repositories') {
		return json({
			total_count: 1,
			repositories: [{ full_name: 'alice/secret', private: true, description: null }],
		});
	}
	return json({ message: 'unexpected' }, 500);
};

/** 450 most-installed skills, served 200 per page like skills.sh. */
const board = Array.from({ length: 450 }, (_, index) => ({
	source: 'top/skills',
	skillId: `top-${index}`,
	name: `top-${index}`,
	installs: 1000 - index,
}));

const fakeSkillsSh: typeof fetch = async (input) => {
	const url = new URL(String(input));
	if (url.pathname === '/acme/skills/pdf') {
		return new Response(
			'<html><head><meta name="description" content="Fill &amp; sign PDF forms"/></head></html>',
			{ headers: { 'content-type': 'text/html' } },
		);
	}
	if (!url.pathname.startsWith('/api/')) return new Response('missing', { status: 404 });
	const boardPage = /^\/api\/skills\/(all-time|trending)\/(\d+)$/.exec(url.pathname);
	if (boardPage) {
		const page = Number(boardPage[2]);
		const skills = boardPage[1] === 'trending' ? board.slice(0, 2).reverse() : board;
		return json({
			skills: skills.slice(page * 200, page * 200 + 200),
			total: skills.length,
			hasMore: (page + 1) * 200 < skills.length,
			page,
		});
	}
	return json({
		skills: [
			{ source: 'acme/skills', skillId: 'pdf', name: 'pdf', installs: 42 },
			{ source: 'not a repo', skillId: 'x', name: 'x' },
		].filter((hit) => hit.name.includes(url.searchParams.get('q') ?? '')),
	});
};

const fakeRegistry: typeof fetch = async (input) => {
	const url = new URL(String(input));
	const weather = {
		name: 'io.github.acme/weather',
		description: 'Weather',
		repository: { url: 'https://github.com/acme/weather' },
		packages: [{ registryType: 'npm', identifier: '@acme/weather' }],
	};
	if (url.pathname === '/v0/servers' && url.searchParams.get('cursor') === 'page-2') {
		return json({ servers: [{ server: { ...weather, name: 'io.github.acme/tides' } }] });
	}
	if (url.pathname === '/v0/servers') {
		return json({
			servers: [{ server: weather }, { server: { name: 'x/unrunnable' } }],
			metadata: { nextCursor: 'page-2' },
		});
	}
	if (url.pathname === '/v0/servers/io.github.acme%2Fweather/versions/latest') {
		return json({ server: weather });
	}
	return json({}, 404);
};

const decode = (file: { content_b64: string }) =>
	Buffer.from(file.content_b64, 'base64').toString('utf8');

describe('marketplaces', () => {
	let h: Harness;
	let alice: Account;
	let bob: Account;
	let mcpIndex: McpRegistryIndex;

	beforeAll(async () => {
		const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
		h = await createHarness(
			{},
			{
				configure: (deps) => {
					deps.github = new GithubImporter(fakeGithub);
					deps.skillsSh = new SkillsShClient(fakeSkillsSh);
					deps.mcpRegistry = new McpRegistryClient(fakeRegistry);
					deps.mcpIndex = mcpIndex = new McpRegistryIndex(deps.mcpRegistry, deps.db);
					deps.githubApp = new GithubApp(
						{
							appId: '1',
							slug: 'skillpouch-test',
							clientId: 'Iv1.test',
							clientSecret: 'secret',
							privateKey: privateKey
								.export({ type: 'pkcs1', format: 'pem' })
								.toString(),
						},
						fakeGithubApp,
					);
				},
			},
		);
		alice = await setupAccount(h, 'alice@marketplaces.test');
		bob = await setupAccount(h, 'bob@marketplaces.test');
	});
	afterAll(async () => {
		await h.close();
	});

	it('lists the built-in marketplaces and the GitHub App', async () => {
		const response = await alice.browser.get('/v1/marketplaces');
		expect(response.status).toBe(200);
		const { marketplaces, github } = response.body.data;
		expect(marketplaces.map((entry: { id: string }) => entry.id)).toEqual([
			'skills-sh',
			'mcp-registry',
			'anthropic-skills',
			'vercel-agent-skills',
		]);
		expect(github).toMatchObject({
			available: true,
			install_url: 'https://github.com/apps/skillpouch-test/installations/new',
			connections: [],
		});
	});

	describe('a repository marketplace', () => {
		let id: string;

		it('is added once, by name or URL', async () => {
			const first = await alice.browser.post('/v1/marketplaces', { repo: 'acme/skills' });
			expect(first.status).toBe(200);
			expect(first.body.data).toMatchObject({
				source: 'github',
				private: false,
				builtin: false,
			});
			id = first.body.data.id;
			const again = await alice.browser.post('/v1/marketplaces', {
				repo: 'https://github.com/acme/skills.git',
			});
			expect(again.body.data.id).toBe(id);
		});

		it('lists skills, agents and each MCP server with descriptions', async () => {
			const response = await alice.browser.get(`/v1/marketplaces/${id}/items`);
			expect(response.status).toBe(200);
			expect(
				response.body.data.items.map(
					(item: { kind: string; name: string; key: string }) => [
						item.kind,
						item.name,
						item.key,
					],
				),
			).toEqual([
				['agent', 'reviewer', 'agents/reviewer.md'],
				['skill', 'pdf', 'pdf'],
				['mcp_server', 'github', 'tools/.mcp.json#github'],
			]);
			const skill = response.body.data.items[1];
			expect(skill.description).toBe('Fill and merge PDF files');

			const filtered = await alice.browser.get(
				`/v1/marketplaces/${id}/items?q=merge&kind=skill`,
			);
			expect(filtered.body.data.items).toHaveLength(1);
		});

		it('returns one item with paths relative to it', async () => {
			const skill = await alice.browser.get(`/v1/marketplaces/${id}/item?key=pdf`);
			expect(skill.status).toBe(200);
			expect(skill.body.data.files.map((file: { path: string }) => file.path)).toEqual([
				'SKILL.md',
				'scripts/fill.py',
			]);
			const server = await alice.browser.get(
				`/v1/marketplaces/${id}/item?key=${encodeURIComponent('tools/.mcp.json#github')}`,
			);
			expect(JSON.parse(decode(server.body.data.files[0]))).toEqual({
				name: 'github',
				description: '',
				command: 'npx',
				args: ['gh-mcp'],
			});
		});

		it('belongs to its account', async () => {
			expect((await bob.browser.get(`/v1/marketplaces/${id}/items`)).status).toBe(404);
			expect((await bob.browser.delete(`/v1/marketplaces/${id}`)).status).toBe(404);
		});

		it('can be removed; built-ins cannot', async () => {
			expect((await alice.browser.delete('/v1/marketplaces/skills-sh')).status).toBe(400);
			expect((await alice.browser.delete(`/v1/marketplaces/${id}`)).status).toBe(200);
			const list = await alice.browser.get('/v1/marketplaces');
			expect(list.body.data.marketplaces).toHaveLength(4);
		});
	});

	it('searches skills.sh and reads the skill from its GitHub repo', async () => {
		const search = await alice.browser.get('/v1/marketplaces/skills-sh/items?q=pdf');
		expect(search.body.data.items).toEqual([
			{
				key: 'acme/skills@pdf',
				kind: 'skill',
				name: 'pdf',
				description: 'Fill & sign PDF forms',
				repo: 'acme/skills',
				installs: 42,
			},
		]);
		const item = await alice.browser.get(
			`/v1/marketplaces/skills-sh/item?key=${encodeURIComponent('acme/skills@pdf')}`,
		);
		expect(item.body.data).toMatchObject({ kind: 'skill', name: 'pdf' });
		expect(decode(item.body.data.files[0])).toBe(SKILL_MD);
	});

	it('lists the most installed skills.sh skills before a search, 30 at a time', async () => {
		const names = (response: { body: { data: { items: { name: string }[] } } }) =>
			response.body.data.items.map((item) => item.name);
		const first = await alice.browser.get('/v1/marketplaces/skills-sh/items');
		expect(first.body.data).toMatchObject({ next_cursor: '30', total: 450 });
		expect(names(first)).toHaveLength(30);
		expect(names(first)[0]).toBe('top-0');

		const acrossPages = await alice.browser.get('/v1/marketplaces/skills-sh/items?cursor=180');
		expect(names(acrossPages)).toEqual(board.slice(180, 200).map((hit) => hit.name));
		expect(acrossPages.body.data.next_cursor).toBe('200');

		const last = await alice.browser.get('/v1/marketplaces/skills-sh/items?cursor=420');
		expect(names(last)).toEqual(board.slice(420).map((hit) => hit.name));
		expect(last.body.data.next_cursor).toBeNull();

		const trending = await alice.browser.get('/v1/marketplaces/skills-sh/items?sort=trending');
		expect(names(trending)).toEqual(['top-1', 'top-0']);
		expect(trending.body.data.next_cursor).toBeNull();

		const bad = await alice.browser.get('/v1/marketplaces/skills-sh/items?cursor=abc');
		expect(bad.status).toBe(400);
	});

	it('pages through the MCP Registry search with its own cursor until the index is built', async () => {
		const first = await alice.browser.get('/v1/marketplaces/mcp-registry/items');
		expect(first.body.data.next_cursor).toBe('r.page-2');
		const second = await alice.browser.get(
			'/v1/marketplaces/mcp-registry/items?cursor=r.page-2',
		);
		expect(second.body.data.items.map((item: { name: string }) => item.name)).toEqual([
			'tides',
		]);
		expect(second.body.data.next_cursor).toBeNull();
	});

	it('turns MCP Registry entries into server configs', async () => {
		const search = await alice.browser.get('/v1/marketplaces/mcp-registry/items?q=weather');
		expect(search.body.data.items).toEqual([
			expect.objectContaining({
				key: 'io.github.acme/weather',
				name: 'weather',
				repo: 'acme/weather',
			}),
		]);
		const item = await alice.browser.get(
			`/v1/marketplaces/mcp-registry/item?key=${encodeURIComponent('io.github.acme/weather')}`,
		);
		expect(JSON.parse(decode(item.body.data.files[0]))).toMatchObject({
			name: 'weather',
			command: 'npx',
			args: ['-y', '@acme/weather'],
		});
	});

	it('searches the MCP Registry index once it is built', async () => {
		await mcpIndex.sync();
		const all = await alice.browser.get('/v1/marketplaces/mcp-registry/items');
		expect(all.body.data).toMatchObject({ next_cursor: null, total: 2 });
		expect(all.body.data.items.map((item: { name: string }) => item.name)).toEqual([
			'tides',
			'weather',
		]);
		const search = await alice.browser.get('/v1/marketplaces/mcp-registry/items?q=tide');
		expect(search.body.data.items.map((item: { key: string }) => item.key)).toEqual([
			'io.github.acme/tides',
		]);
		const stillRemote = await alice.browser.get(
			'/v1/marketplaces/mcp-registry/items?cursor=r.page-2',
		);
		expect(stillRemote.body.data.items).toHaveLength(1);
	});

	describe('private repositories', () => {
		it('are not found before GitHub is connected', async () => {
			const response = await alice.browser.post('/v1/marketplaces', { repo: 'alice/secret' });
			expect(response.status).toBe(404);
		});

		it('connecting keeps only the user’s own installations and orgs they administer', async () => {
			const response = await alice.browser.post('/v1/github/connect', { code: 'abc' });
			expect(response.status).toBe(200);
			expect(
				response.body.data.connections.map(
					(connection: { installation_id: number }) => connection.installation_id,
				),
			).toEqual([11, 12]);
		});

		it('are read through the installation', async () => {
			const repos = await alice.browser.get('/v1/github/repositories');
			expect(repos.body.data.repositories).toContainEqual(
				expect.objectContaining({ full_name: 'alice/secret', installation_id: 11 }),
			);
			const added = await alice.browser.post('/v1/marketplaces', { repo: 'alice/secret' });
			expect(added.body.data).toMatchObject({ private: true, repo: 'alice/secret' });
			const item = await alice.browser.get(
				`/v1/marketplaces/${added.body.data.id}/item?key=mine`,
			);
			expect(decode(item.body.data.files[0])).toBe(SKILL_MD);
			expect(
				(await bob.browser.get(`/v1/marketplaces/${added.body.data.id}/items`)).status,
			).toBe(404);
		});

		it('another account cannot use them without its own connection', async () => {
			expect(
				(await bob.browser.post('/v1/marketplaces', { repo: 'alice/secret' })).status,
			).toBe(404);
		});

		it('disconnecting removes the private marketplaces', async () => {
			expect((await alice.browser.delete('/v1/github/connect')).status).toBe(200);
			const list = await alice.browser.get('/v1/marketplaces');
			expect(
				list.body.data.marketplaces.some((entry: { private: boolean }) => entry.private),
			).toBe(false);
			expect(list.body.data.github.connections).toEqual([]);
		});
	});
});
