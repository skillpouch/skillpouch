// SPDX-License-Identifier: AGPL-3.0-only
import { getContainerRenderer } from '@astrojs/react/container-renderer';
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { loadRenderers } from 'astro:container';
import { beforeAll, describe, expect, it } from 'vitest';
import { ASSISTANTS, FAQS } from '../landing-content';
import AboutPage from '../../pages/about.astro';
import ComparePage from '../../pages/compare.astro';
import FaqPage from '../../pages/faq.astro';
import NotFoundPage from '../../pages/404.astro';

let container: AstroContainer;
beforeAll(async () => {
	container = await AstroContainer.create({
		astroConfig: { site: 'https://skillpouch.net' },
		renderers: await loadRenderers([getContainerRenderer()]),
	});
});

/** The page's JSON-LD graph. */
function graph(html: string): Record<string, unknown>[] {
	const body = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)?.[1];
	expect(body).toBeDefined();
	return JSON.parse(body!)['@graph'];
}

const decode = (text: string) => text.replace(/&#39;/g, "'").replace(/&quot;/g, '"');

describe('content pages', () => {
	for (const [name, page, path] of [
		['About', AboutPage, '/about/'],
		['Compare', ComparePage, '/compare/'],
		['FAQ', FaqPage, '/faq/'],
	] as const) {
		it(`${name}: one h1, its own canonical, a breadcrumb trail and nothing hidden from search`, async () => {
			const html = await container.renderToString(page);
			expect(html.match(/<h1\b/g)).toHaveLength(1);
			expect(html).toContain(`<link rel="canonical" href="https://skillpouch.net${path}">`);
			expect(html).toContain('<meta name="robots" content="index, follow">');
			expect(html).toContain('aria-label="Breadcrumb"');
			const crumbs = graph(html).find((node) => node['@type'] === 'BreadcrumbList');
			expect(crumbs?.itemListElement).toHaveLength(2);
		});
	}

	it('FAQ: every question is on the page and in the FAQPage markup, once', async () => {
		const html = decode(await container.renderToString(FaqPage));
		const faqPage = graph(html).filter((node) => node['@type'] === 'FAQPage');
		expect(faqPage).toHaveLength(1);
		const questions = (faqPage[0]!.mainEntity as { name: string }[]).map(
			(entity) => entity.name,
		);
		expect(questions).toEqual(FAQS.map((faq) => faq.question));
		for (const faq of FAQS) expect(html).toContain(`<h2>${faq.question}</h2>`);
	});

	it('About: lists every supported assistant', async () => {
		const html = await container.renderToString(AboutPage);
		for (const assistant of ASSISTANTS) expect(html).toContain(assistant.path);
	});

	it('404: kept out of the index, without a canonical', async () => {
		const html = await container.renderToString(NotFoundPage);
		expect(html).toContain('<meta name="robots" content="noindex, follow">');
		expect(html).not.toContain('rel="canonical"');
	});
});
