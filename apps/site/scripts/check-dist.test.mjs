// SPDX-License-Identifier: AGPL-3.0-only
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { checkSite, readPage, urlPath } from './check-dist.mjs';

const ORIGIN = 'https://skillpouch.net';

function page({
	path,
	title = `Title of ${path}`,
	canonical = `${ORIGIN}${path}`,
	noindex,
	body = '',
}) {
	return `<!doctype html><html lang="en"><head><title>${title}</title>
<meta name="description" content="About ${path}">
${noindex ? '<meta name="robots" content="noindex, follow">' : '<meta name="robots" content="index, follow">'}
${canonical ? `<link rel="canonical" href="${canonical}">` : ''}
<script type="application/ld+json">{"@context":"https://schema.org","@type":"WebPage"}</script>
</head><body>${body}</body></html>`;
}

function site(files) {
	const dist = mkdtempSync(join(tmpdir(), 'check-dist-'));
	for (const [file, content] of Object.entries(files)) {
		mkdirSync(dirname(join(dist, file)), { recursive: true });
		writeFileSync(join(dist, file), content);
	}
	return dist;
}

const sitemap = (...paths) =>
	`<urlset>${paths.map((path) => `<url><loc>${ORIGIN}${path}</loc></url>`).join('')}</urlset>`;
const ROBOTS = `User-agent: *\nAllow: /\n\nSitemap: ${ORIGIN}/sitemap.xml\n`;

function goodSite(overrides = {}) {
	return site({
		'index.html': page({
			path: '/',
			body: '<a href="/faq/">FAQ</a> <a href="/docs/x">docs</a>',
		}),
		'faq/index.html': page({ path: '/faq/', body: `<a href="${ORIGIN}/#pricing">Pricing</a>` }),
		'404.html': page({ path: '/404/', noindex: true, canonical: '' }),
		'robots.txt': ROBOTS,
		'sitemap.xml': sitemap('/', '/faq/'),
		_redirects: '/docs/* https://docs.skillpouch.net/:splat 301\n',
		...overrides,
	});
}

describe('check-dist', () => {
	it('maps files to the paths they are served at', () => {
		expect(urlPath('index.html')).toBe('/');
		expect(urlPath(join('terms', 'index.html'))).toBe('/terms/');
		expect(urlPath('404.html')).toBe('/404.html');
	});

	it('reads what a crawler reads', () => {
		const read = readPage(page({ path: '/faq/', body: '<a href="/x/?a=1&amp;b=2">x</a>' }));
		expect(read).toMatchObject({
			title: 'Title of /faq/',
			description: 'About /faq/',
			lang: 'en',
			canonicals: [`${ORIGIN}/faq/`],
			links: ['/x/?a=1&b=2'],
			noindex: false,
		});
	});

	it('passes a good site', () => {
		expect(checkSite(goodSite(), ORIGIN)).toEqual([]);
	});

	it('finds a canonical that points elsewhere, and a duplicate title', () => {
		const dist = goodSite({
			'faq/index.html': page({
				path: '/faq/',
				title: 'Title of /',
				canonical: `${ORIGIN}/faq`,
			}),
		});
		expect(checkSite(dist, ORIGIN)).toEqual([
			`/faq/: canonical ${ORIGIN}/faq is not ${ORIGIN}/faq/`,
			'/: same title as /faq/',
		]);
	});

	it('finds broken internal links', () => {
		const dist = goodSite({
			'index.html': page({ path: '/', body: '<a href="/terms">Terms</a>' }),
		});
		expect(checkSite(dist, ORIGIN)).toEqual(['/: broken link /terms']);
	});

	it('finds a sitemap out of step with the pages', () => {
		const dist = goodSite({
			'sitemap.xml': sitemap('/', '/gone/', '/hidden/'),
			'hidden/index.html': page({ path: '/hidden/', noindex: true }),
		});
		expect(checkSite(dist, ORIGIN)).toEqual([
			`sitemap lists ${ORIGIN}/gone/, which is not an indexable page`,
			`sitemap lists ${ORIGIN}/hidden/, which is not an indexable page`,
			'/faq/: indexable but not in the sitemap',
		]);
	});

	it('follows a sitemap index', () => {
		const dist = goodSite({
			'robots.txt': ROBOTS.replace('sitemap.xml', 'sitemap-index.xml'),
			'sitemap-index.xml': `<sitemapindex><sitemap><loc>${ORIGIN}/sitemap-0.xml</loc></sitemap></sitemapindex>`,
			'sitemap-0.xml': sitemap('/', '/faq/'),
		});
		expect(checkSite(dist, ORIGIN)).toEqual([]);
	});

	it('refuses robots.txt that shuts everyone out, and an indexable 404', () => {
		const dist = goodSite({
			'robots.txt': `User-agent: *\nDisallow: /\n\nSitemap: ${ORIGIN}/sitemap.xml\n`,
			'404.html': page({ path: '/404/' }),
		});
		expect(checkSite(dist, ORIGIN)).toEqual([
			'/404.html: the not-found page should be noindex',
			'robots.txt disallows the whole site',
		]);
	});

	it('refuses JSON-LD that does not parse', () => {
		const dist = goodSite({
			'faq/index.html': page({ path: '/faq/' }).replace('"@type":"WebPage"}', '"@type":'),
		});
		expect(checkSite(dist, ORIGIN)).toEqual(['/faq/: JSON-LD does not parse']);
	});
});
