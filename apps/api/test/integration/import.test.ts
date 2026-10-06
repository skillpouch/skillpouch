// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `GET /v1/import/github/scan` against a fake GitHub: only
 * fixed GitHub hosts are contacted, results are cached per commit, inputs
 * that could steer requests elsewhere are rejected.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { GithubImporter } from '../../src/modules/import/github.service';
import { setupAccount, type Account } from '../helpers/flows';
import { createHarness, type Harness } from '../helpers/harness';

describe('GitHub import scan', () => {
	let h: Harness;
	let alice: Account;
	const hosts = new Set<string>();
	let treeCalls = 0;

	const fakeGithub: typeof fetch = async (input) => {
		const url = new URL(String(input));
		hosts.add(url.host);
		const json = (value: unknown) =>
			new Response(JSON.stringify(value), {
				headers: { 'content-type': 'application/json' },
			});
		if (url.pathname === '/repos/acme/skills') return json({ default_branch: 'main' });
		if (url.pathname === '/repos/acme/skills/commits/main') return json({ sha: 'abc123' });
		if (url.pathname === '/repos/acme/skills/git/trees/abc123') {
			treeCalls += 1;
			return json({
				tree: [
					{ path: 'pdf/SKILL.md', type: 'blob', size: 12 },
					{ path: 'pdf/huge.bin', type: 'blob', size: 5 * 1024 * 1024 },
					{ path: 'AGENTS.md', type: 'blob', size: 7 },
				],
			});
		}
		if (url.host === 'raw.githubusercontent.com')
			return new Response(`content of ${url.pathname}`);
		return new Response('missing', { status: 404 });
	};

	beforeAll(async () => {
		h = await createHarness(
			{},
			{ configure: (deps) => (deps.github = new GithubImporter(fakeGithub)) },
		);
		alice = await setupAccount(h, 'alice@skillpouch.test');
	});
	afterAll(async () => {
		await h.close();
	});

	it('returns detected items with contents and respects size caps', async () => {
		const response = await alice.browser.get('/v1/import/github/scan?repo=acme/skills');
		expect(response.status).toBe(200);
		const { items, sha, ref } = response.body.data;
		expect({ sha, ref }).toEqual({ sha: 'abc123', ref: 'main' });
		const skill = items.find((item: { kind: string }) => item.kind === 'skill');
		expect(skill).toMatchObject({ path: 'pdf', name: 'pdf', truncated: true });
		expect(skill.files.map((file: { path: string }) => file.path)).toEqual(['pdf/SKILL.md']);
		expect(Buffer.from(skill.files[0].content_b64, 'base64').toString()).toBe(
			'content of /acme/skills/abc123/pdf/SKILL.md',
		);
		expect([...hosts].sort()).toEqual(['api.github.com', 'raw.githubusercontent.com']);
	});

	it('caches per commit', async () => {
		await alice.browser.get('/v1/import/github/scan?repo=acme/skills&ref=main');
		expect(treeCalls).toBe(1);
	});

	it('rejects anything that is not owner/name', async () => {
		for (const repo of ['evil.example/x/y', '../etc', 'https://x', 'a']) {
			const response = await alice.browser.get(
				`/v1/import/github/scan?repo=${encodeURIComponent(repo)}`,
			);
			expect(response.status).toBe(400);
		}
	});

	it('maps unknown repositories to 404', async () => {
		expect((await alice.browser.get('/v1/import/github/scan?repo=acme/private')).status).toBe(
			404,
		);
	});
});
