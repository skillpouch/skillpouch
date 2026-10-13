// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { FAQS, type Plan } from '@/components/landing-content';
import {
	breadcrumbList,
	faqEntities,
	jsonLd,
	organization,
	softwareApplication,
	webPage,
	website,
} from '@/lib/structured-data';

const PLANS = [
	{ slug: 'free', name: 'Free', price_cents: 0, currency: 'usd', interval: null },
	{ slug: 'supporter', name: 'Supporter', price_cents: 300, currency: 'usd', interval: 'month' },
] as Plan[];

describe('structured data', () => {
	it('links the page, the site, the organization and the software by id', () => {
		const graph = JSON.parse(
			jsonLd([organization(), website(), softwareApplication('d'), webPage('/', 't', 'd')]),
		);
		expect(graph['@context']).toBe('https://schema.org');
		const ids = new Set(graph['@graph'].map((node: { '@id': string }) => node['@id']));
		for (const node of graph['@graph']) {
			for (const ref of [node.publisher, node.isPartOf, node.about]) {
				if (ref) expect(ids).toContain(ref['@id']);
			}
		}
	});

	it('offers the free plan without plans, and every plan with them', () => {
		expect(softwareApplication('d').offers).toEqual([
			{ '@type': 'Offer', name: 'Free', price: '0', priceCurrency: 'USD' },
		]);
		const offers = softwareApplication('d', PLANS).offers as Record<string, unknown>[];
		expect(offers.map((offer) => [offer.name, offer.price])).toEqual([
			['Free', '0.00'],
			['Supporter', '3.00'],
		]);
		expect(offers[0]).not.toHaveProperty('priceSpecification');
		expect(offers[1]!.priceSpecification).toMatchObject({ unitCode: 'MON', price: '3.00' });
	});

	it('numbers breadcrumbs from one with absolute URLs', () => {
		expect(
			breadcrumbList([
				{ name: 'Home', path: '/' },
				{ name: 'FAQ', path: '/faq/' },
			]),
		).toEqual({
			'@type': 'BreadcrumbList',
			itemListElement: [
				{ '@type': 'ListItem', position: 1, name: 'Home', item: 'https://skillpouch.net/' },
				{
					'@type': 'ListItem',
					position: 2,
					name: 'FAQ',
					item: 'https://skillpouch.net/faq/',
				},
			],
		});
	});

	it('marks up every FAQ, as plain text', () => {
		const entities = faqEntities(FAQS);
		expect(entities).toHaveLength(FAQS.length);
		for (const entity of entities) {
			expect((entity.acceptedAnswer as { text: string }).text).not.toContain('`');
		}
	});

	it('cannot close its own script tag', () => {
		expect(jsonLd([{ name: '</script><script>' }])).not.toContain('</script>');
	});
});
