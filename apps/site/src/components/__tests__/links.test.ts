// SPDX-License-Identifier: AGPL-3.0-only
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { DEFAULT_APP_URL, DEV_APP_URL, DOCS_PAGES, DOCS_URL, resolveAppUrl } from '@/lib/links';

describe('app links', () => {
	it('point at the hosted app, or the local one in development', () => {
		expect(resolveAppUrl(undefined, false)).toBe(DEFAULT_APP_URL);
		expect(resolveAppUrl('', false)).toBe(DEFAULT_APP_URL);
		expect(resolveAppUrl(undefined, true)).toBe(DEV_APP_URL);
	});

	it('follow the configured origin without a trailing slash', () => {
		expect(resolveAppUrl('https://pouch.example.com/', false)).toBe(
			'https://pouch.example.com',
		);
		expect(resolveAppUrl(' http://localhost:15173 ', true)).toBe('http://localhost:15173');
	});
});

describe('docs links', () => {
	const docsContent = (path: string) =>
		fileURLToPath(new URL(`../../../../docs/src/content/docs/${path}`, import.meta.url));

	it.each(Object.entries(DOCS_PAGES))('%s points at a docs page that exists', (_, url) => {
		expect(url.startsWith(`${DOCS_URL}/`)).toBe(true);
		expect(url.endsWith('/')).toBe(true);
		const slug = url.slice(DOCS_URL.length + 1, -1);
		const candidates = [`${slug}.md`, `${slug}.mdx`, `${slug}/index.md`, `${slug}/index.mdx`];
		expect(candidates.some((path) => existsSync(docsContent(path)))).toBe(true);
	});
});
