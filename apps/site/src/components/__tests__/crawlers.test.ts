// SPDX-License-Identifier: AGPL-3.0-only
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ASSISTANTS, INSTALL_COMMAND } from '@/components/landing-content';
import { llmsTxt } from '@/lib/llms';

const siteFile = (path: string) => fileURLToPath(new URL(`../../../${path}`, import.meta.url));

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
});

describe('sitemap', () => {
	it('lists every page', () => {
		const sitemap = readFileSync(siteFile('public/sitemap.xml'), 'utf8');
		const pages = readdirSync(siteFile('src/pages')).filter((file) => file.endsWith('.astro'));
		expect(pages.length).toBeGreaterThan(0);
		for (const page of pages) {
			const path = page === 'index.astro' ? '' : page.replace(/\.astro$/, '');
			expect(sitemap).toContain(`<loc>https://skillpouch.net/${path}</loc>`);
		}
	});

	it('is where robots.txt says', () => {
		expect(readFileSync(siteFile('public/robots.txt'), 'utf8')).toContain(
			'Sitemap: https://skillpouch.net/sitemap.xml',
		);
	});
});
