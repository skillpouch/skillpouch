// SPDX-License-Identifier: AGPL-3.0-only
/** Reading repositories never makes a user wait on GitHub one file or lookup at a time. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GithubImporter } from '../../src/modules/import/github.service';

function fakeGithub(files: number) {
	const state = { inFlight: 0, peak: 0, commits: 0, sha: 'one', release: () => {} };
	let gate = Promise.resolve();
	const http: typeof fetch = async (input) => {
		const url = new URL(String(input));
		const json = (value: unknown) => new Response(JSON.stringify(value));
		if (url.host === 'raw.githubusercontent.com') {
			state.inFlight += 1;
			state.peak = Math.max(state.peak, state.inFlight);
			await new Promise((resolve) => setTimeout(resolve, 5));
			state.inFlight -= 1;
			return new Response('# file');
		}
		const kind = url.pathname.split('/')[4];
		if (kind === 'commits') {
			state.commits += 1;
			await gate;
			return json({ sha: state.sha });
		}
		if (kind === 'git') {
			return json({
				tree: Array.from({ length: files }, (_, index) => ({
					path: `skills/big/${index === 0 ? 'SKILL.md' : `ref-${index}.md`}`,
					type: 'blob',
					size: 6,
				})),
			});
		}
		return json({ default_branch: 'main' });
	};
	return {
		http,
		state,
		/** Holds commit lookups until the returned function is called. */
		hold() {
			gate = new Promise<void>((resolve) => (state.release = resolve));
		},
	};
}

afterEach(() => vi.useRealTimers());

describe('GitHub reads', () => {
	it('downloads an item’s files in parallel, in tree order', async () => {
		const github = fakeGithub(40);
		const importer = new GithubImporter(github.http);
		const snapshot = await importer.snapshot('acme/skills');
		const { files } = await importer.readItem(snapshot, snapshot.items[0]!);
		expect(files).toHaveLength(40);
		expect(files[0]!.path).toBe('SKILL.md');
		expect(files.map((file) => file.path)).toEqual(
			snapshot.items[0]!.files.map((entry) => entry.path.slice('skills/big/'.length)),
		);
		expect(github.state.peak).toBeGreaterThan(1);
		expect(github.state.peak).toBeLessThanOrEqual(16);
	});

	it('keeps serving a branch’s last commit while it looks up the new one', async () => {
		vi.useFakeTimers({ toFake: ['Date'] });
		const github = fakeGithub(1);
		const importer = new GithubImporter(github.http);
		expect((await importer.snapshot('acme/skills')).sha).toBe('one');

		vi.setSystemTime(Date.now() + 3 * 60_000);
		github.state.sha = 'two';
		github.hold();
		expect((await importer.snapshot('acme/skills')).sha).toBe('one');
		await vi.waitFor(() => expect(github.state.commits).toBe(2));
		expect((await importer.snapshot('acme/skills')).sha).toBe('one');

		github.state.release();
		await vi.waitFor(async () => {
			expect((await importer.snapshot('acme/skills')).sha).toBe('two');
		});
		expect(github.state.commits).toBe(2);
	});
});
