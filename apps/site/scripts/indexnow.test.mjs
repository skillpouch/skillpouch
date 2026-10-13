// SPDX-License-Identifier: AGPL-3.0-only
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { builtUrls, changedUrls, INDEXNOW_KEY, submit } from './indexnow.mjs';

const DOCS = 'https://docs.skillpouch.net';
const URLS = [`${DOCS}/`, `${DOCS}/cli/`, `${DOCS}/cli/login/`, `${DOCS}/assistants/`];

describe('indexnow', () => {
	it('reads page URLs through a sitemap index', () => {
		const dist = mkdtempSync(join(tmpdir(), 'indexnow-'));
		writeFileSync(
			join(dist, 'sitemap-index.xml'),
			`<sitemapindex><sitemap><loc>${DOCS}/sitemap-0.xml</loc></sitemap></sitemapindex>`,
		);
		writeFileSync(
			join(dist, 'sitemap-0.xml'),
			`<urlset><url><loc>${DOCS}/</loc></url><url><loc>${DOCS}/cli/</loc></url></urlset>`,
		);
		expect(builtUrls(dist)).toEqual([`${DOCS}/`, `${DOCS}/cli/`]);
	});

	it('sends only the docs pages that changed', () => {
		expect(
			changedUrls(
				URLS,
				[
					'apps/docs/src/content/docs/cli/login.md',
					'apps/docs/src/content/docs/cli/index.md',
					'apps/docs/src/content/docs/index.mdx',
					'apps/web/src/main.tsx',
				],
				'apps/docs',
				DOCS,
			),
		).toEqual([`${DOCS}/`, `${DOCS}/cli/`, `${DOCS}/cli/login/`]);
	});

	it('sends every page when shared code changed, and none for other apps', () => {
		expect(changedUrls(URLS, ['apps/docs/astro.config.ts'], 'apps/docs', DOCS)).toEqual(URLS);
		expect(changedUrls(URLS, ['packages/contracts/src/errors.ts'], 'apps/docs', DOCS)).toEqual(
			URLS,
		);
		expect(changedUrls(URLS, ['apps/web/src/main.tsx'], 'apps/docs', DOCS)).toEqual([]);
	});

	it('posts the host, key, key location and URLs', async () => {
		let request;
		const status = await submit(DOCS, [`${DOCS}/`], async (url, init) => {
			request = { url, body: JSON.parse(init.body) };
			return { status: 202 };
		});
		expect(status).toBe(202);
		expect(request).toEqual({
			url: 'https://api.indexnow.org/indexnow',
			body: {
				host: 'docs.skillpouch.net',
				key: INDEXNOW_KEY,
				keyLocation: `${DOCS}/${INDEXNOW_KEY}.txt`,
				urlList: [`${DOCS}/`],
			},
		});
	});
});
