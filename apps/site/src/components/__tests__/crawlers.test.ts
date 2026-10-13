// SPDX-License-Identifier: AGPL-3.0-only
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ASSISTANTS, FAQS, INSTALL_COMMAND } from '@/components/landing-content';
import { llmsTxt } from '@/lib/llms';
import { pagePath, SITE_PAGES } from '@/lib/pages';
import { sitemapXml } from '@/lib/sitemap';

const siteFile = (path: string) => fileURLToPath(new URL(`../../../${path}`, import.meta.url));
const read = (path: string) => readFileSync(siteFile(path), 'utf8');

describe('llms.txt', () => {
	const text = llmsTxt();

	it('starts with the title and summary llmstxt.org asks for', () => {
		const [title, blank, summary] = text.split('\n');
		expect(title).toBe('# SkillPouch');
		expect(blank).toBe('');
		expect(summary).toMatch(/^> /);
	});

	it('names every assistant the landing page does, and how to install', () => {
		for (const assistant of ASSISTANTS) expect(text).toContain(assistant.name);
		expect(text).toContain(INSTALL_COMMAND);
		expect(text).toContain('https://docs.skillpouch.net/llms.txt');
	});

	it('answers every FAQ and links the public pages', () => {
		for (const faq of FAQS) expect(text).toContain(faq.question);
		for (const page of SITE_PAGES.filter((page) => page.path !== '/')) {
			if (page.path === '/terms/' || page.path === '/privacy/') continue;
			expect(text).toContain(`https://skillpouch.net${page.path}`);
		}
		expect(text).toContain('https://github.com/skillpouch/skillpouch-cli');
	});
});

describe('sitemap', () => {
	it('lists every page and nothing else', () => {
		const pages = readdirSync(siteFile('src/pages'))
			.filter((file) => file.endsWith('.astro') && file !== '404.astro')
			.map(pagePath)
			.sort();
		expect(SITE_PAGES.map((page) => page.path).sort()).toEqual(pages);
	});

	it('uses the URLs pages are served at, with a trailing slash', () => {
		for (const page of SITE_PAGES) expect(page.path).toMatch(/^\/([a-z-]+\/)*$/);
	});

	it('writes valid sitemap XML, with a date only where one is known', () => {
		const xml = sitemapXml([
			{ loc: 'https://skillpouch.net/', lastmod: '2026-10-12T10:00:00+02:00' },
			{ loc: 'https://skillpouch.net/faq/?a=1&b=2' },
		]);
		expect(xml).toMatch(/^<\?xml version="1.0" encoding="UTF-8"\?>\n<urlset xmlns=/);
		expect(xml).toContain(
			'<url><loc>https://skillpouch.net/</loc><lastmod>2026-10-12T10:00:00+02:00</lastmod></url>',
		);
		expect(xml).toContain('<url><loc>https://skillpouch.net/faq/?a=1&#38;b=2</loc></url>');
	});
});

describe('robots.txt', () => {
	const robots = read('public/robots.txt');

	it('points at the sitemap', () => {
		expect(robots).toContain('Sitemap: https://skillpouch.net/sitemap.xml');
	});

	it('names the search, user and training crawlers, and blocks none of them', () => {
		for (const agent of [
			'Googlebot',
			'Bingbot',
			'OAI-SearchBot',
			'ChatGPT-User',
			'GPTBot',
			'PerplexityBot',
			'Perplexity-User',
			'Claude-SearchBot',
			'Claude-User',
			'ClaudeBot',
			'Applebot',
			'Google-Extended',
			'*',
		]) {
			expect(robots).toMatch(new RegExp(`^User-agent: ${agent.replace('*', '\\*')}$`, 'm'));
		}
		expect(robots).not.toMatch(/^Disallow:/m);
		// Every group ends with its own rule, so no named crawler falls through to nothing.
		const groups = robots.split(/\n\s*\n/).filter((group) => /^User-agent:/m.test(group));
		for (const group of groups) expect(group).toMatch(/^Allow: \/$/m);
	});
});

describe('redirects and verification files', () => {
	it('sends /docs to the docs host', () => {
		const redirects = read('public/_redirects');
		expect(redirects).toMatch(/^\/docs https:\/\/docs\.skillpouch\.net\/ 301$/m);
		expect(redirects).toMatch(/^\/docs\/\* https:\/\/docs\.skillpouch\.net\/:splat 301$/m);
	});

	it('serves the IndexNow key the submit script uses, on both hosts', () => {
		const key = read('scripts/indexnow.mjs').match(/INDEXNOW_KEY = '([0-9a-f]{32})'/)?.[1];
		expect(key).toBeDefined();
		expect(read(`public/${key}.txt`).trim()).toBe(key);
		expect(read(`../docs/public/${key}.txt`).trim()).toBe(key);
	});
});
