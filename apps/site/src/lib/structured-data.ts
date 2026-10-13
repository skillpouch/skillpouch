// SPDX-License-Identifier: AGPL-3.0-only
/**
 * schema.org JSON-LD for the site's pages. Everything here must match what
 * the page shows: search engines ignore (or penalise) markup that doesn't.
 */
import {
	ASSISTANTS,
	CLI_SOURCE_URL,
	DISCORD_URL,
	ITEM_KINDS,
	LICENSE_URL,
	NPM_URL,
	SOURCE_URL,
	type Faq,
	type Plan,
} from '@/components/landing-content';
import { DOCS_URL } from '@/lib/links';

export const SITE_URL = 'https://skillpouch.net';
const ORGANIZATION_ID = `${SITE_URL}/#organization`;
const WEBSITE_ID = `${SITE_URL}/#website`;
const SOFTWARE_ID = `${SITE_URL}/#software`;

type Node = Record<string, unknown>;

export function organization(): Node {
	return {
		'@type': 'Organization',
		'@id': ORGANIZATION_ID,
		name: 'SkillPouch',
		url: `${SITE_URL}/`,
		logo: `${SITE_URL}/icon-512.png`,
		email: 'info@skillpouch.net',
		sameAs: ['https://github.com/skillpouch', DISCORD_URL],
	};
}

export function website(): Node {
	return {
		'@type': 'WebSite',
		'@id': WEBSITE_ID,
		name: 'SkillPouch',
		url: `${SITE_URL}/`,
		inLanguage: 'en',
		publisher: { '@id': ORGANIZATION_ID },
	};
}

/** One offer per public plan; without plans, only the free plan the page promises. */
function offers(plans: readonly Plan[] | undefined): Node[] {
	if (!plans?.length) {
		return [{ '@type': 'Offer', name: 'Free', price: '0', priceCurrency: 'USD' }];
	}
	return plans.map((plan) => ({
		'@type': 'Offer',
		name: plan.name,
		price: (plan.price_cents / 100).toFixed(2),
		priceCurrency: plan.currency.toUpperCase(),
		...(plan.interval
			? {
					priceSpecification: {
						'@type': 'UnitPriceSpecification',
						price: (plan.price_cents / 100).toFixed(2),
						priceCurrency: plan.currency.toUpperCase(),
						billingDuration: 1,
						billingIncrement: 1,
						unitCode: plan.interval === 'year' ? 'ANN' : 'MON',
					},
				}
			: {}),
	}));
}

export function softwareApplication(description: string, plans?: readonly Plan[]): Node {
	return {
		'@type': 'SoftwareApplication',
		'@id': SOFTWARE_ID,
		name: 'SkillPouch',
		url: `${SITE_URL}/`,
		description,
		applicationCategory: 'DeveloperApplication',
		operatingSystem: 'Linux, macOS, Windows',
		isAccessibleForFree: true,
		license: LICENSE_URL,
		downloadUrl: NPM_URL,
		installUrl: `${DOCS_URL}/getting-started/install/`,
		softwareHelp: { '@type': 'CreativeWork', url: `${DOCS_URL}/` },
		featureList: [
			`Syncs ${ITEM_KINDS.join(', ').toLowerCase()} and assistant settings`,
			`Works with ${ASSISTANTS.map((assistant) => assistant.name).join(', ')}`,
			'End-to-end encrypted on your devices before upload',
			'Background sync on every computer',
			'Web app to browse, edit and share items',
			'Open source (AGPL-3.0) and self-hostable',
		],
		sameAs: [SOURCE_URL, CLI_SOURCE_URL, NPM_URL],
		publisher: { '@id': ORGANIZATION_ID },
		offers: offers(plans),
	};
}

export interface Crumb {
	name: string;
	path: string;
}

export function breadcrumbList(crumbs: readonly Crumb[]): Node {
	return {
		'@type': 'BreadcrumbList',
		itemListElement: crumbs.map((crumb, index) => ({
			'@type': 'ListItem',
			position: index + 1,
			name: crumb.name,
			item: new URL(crumb.path, SITE_URL).href,
		})),
	};
}

export function webPage(
	path: string,
	name: string,
	description: string,
	type = 'WebPage',
	extra: Node = {},
): Node {
	return {
		...extra,
		'@type': type,
		'@id': `${new URL(path, SITE_URL).href}#webpage`,
		url: new URL(path, SITE_URL).href,
		name,
		description,
		inLanguage: 'en',
		isPartOf: { '@id': WEBSITE_ID },
		about: { '@id': SOFTWARE_ID },
	};
}

/** The questions of an `FAQPage`, for its `mainEntity`. */
export function faqEntities(faqs: readonly Faq[]): Node[] {
	return faqs.map((faq) => ({
		'@type': 'Question',
		name: faq.question,
		// The page shows `code` spans as code; the markup carries the plain text.
		acceptedAnswer: { '@type': 'Answer', text: faq.answer.replaceAll('`', '') },
	}));
}

/** The `<script type="application/ld+json">` body, safe to inline in HTML. */
export function jsonLd(nodes: readonly Node[]): string {
	return JSON.stringify({ '@context': 'https://schema.org', '@graph': nodes }).replace(
		/</g,
		'\\u003c',
	);
}
