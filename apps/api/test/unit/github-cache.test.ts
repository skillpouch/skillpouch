// SPDX-License-Identifier: AGPL-3.0-only
/** The GitHub scan cache stays within its byte budget however many repos are scanned. */
import { describe, expect, it } from 'vitest';
import { GithubImporter } from '../../src/modules/import/github.service';

/** Every repo has one 900 KB skill file; every commit is distinct. */
const bigRepos: typeof fetch = async (input) => {
	const url = new URL(String(input));
	const json = (value: unknown) => new Response(JSON.stringify(value));
	const [, , owner, name, kind] = url.pathname.split('/');
	if (url.host === 'raw.githubusercontent.com') return new Response('x'.repeat(900 * 1024));
	if (kind === 'commits') return json({ sha: `${owner}-${name}` });
	if (kind === 'git') {
		return json({ tree: [{ path: 'big/SKILL.md', type: 'blob', size: 900 * 1024 }] });
	}
	return json({ default_branch: 'main' });
};

describe('GitHub scan cache', () => {
	it('evicts the oldest scans to stay under 64 MiB', async () => {
		const importer = new GithubImporter(bigRepos);
		for (let index = 0; index < 120; index++) {
			await importer.scan(`acme/repo${index}`, 'main');
			expect(importer.cachedBytes).toBeLessThanOrEqual(64 * 1024 * 1024);
		}
		expect(importer.cachedBytes).toBeGreaterThan(32 * 1024 * 1024);
	});
});
