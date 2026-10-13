// SPDX-License-Identifier: AGPL-3.0-only
/**
 * What search engines should index, and the structured data they read. The
 * generated API reference has a page per endpoint; those stay readable but
 * are kept out of the sitemap and the index so crawlers spend their time on
 * the guides. The `/api/` overview stays.
 */

/** Shared with the site, until the docs have a card of their own. */
export const OG_IMAGE = 'https://skillpouch.net/og.jpg';
export const DOCS_ORIGIN = 'https://docs.skillpouch.net';

/** True for a generated endpoint page, given a path or a full URL. */
export function isApiOperation(pathOrUrl: string): boolean {
	const path = pathOrUrl.startsWith('http') ? new URL(pathOrUrl).pathname : pathOrUrl;
	return path.startsWith('/api/operations/');
}

/** The part of a Starlight sidebar entry this file reads. */
export interface SidebarEntry {
	type: 'link' | 'group';
	label: string;
	href?: string;
	entries?: SidebarEntry[];
}

/** Every page the sidebar links to, by path, with its sidebar label. */
export function sidebarLabels(entries: readonly SidebarEntry[]): Map<string, string> {
	const labels = new Map<string, string>();
	const walk = (list: readonly SidebarEntry[]) => {
		for (const entry of list) {
			if (entry.type === 'link' && entry.href?.startsWith('/')) {
				labels.set(entry.href, entry.label);
			}
			if (entry.entries) walk(entry.entries);
		}
	};
	walk(entries);
	return labels;
}

export interface Crumb {
	name: string;
	path: string;
}

/**
 * Docs home, then each parent folder that is a page of its own, then the
 * page: `/cli/login/` → Docs › Commands (`/cli/`) › login.
 */
export function breadcrumbs(path: string, title: string, labels: Map<string, string>): Crumb[] {
	const crumbs: Crumb[] = [{ name: 'SkillPouch Docs', path: '/' }];
	const segments = path.split('/').filter(Boolean);
	for (let index = 1; index < segments.length; index++) {
		const parent = `/${segments.slice(0, index).join('/')}/`;
		const label = labels.get(parent);
		if (label) crumbs.push({ name: label, path: parent });
	}
	if (path !== '/') crumbs.push({ name: title, path });
	return crumbs;
}

/** TechArticle and BreadcrumbList for one guide, as an inline JSON-LD body. */
export function guideJsonLd(page: {
	path: string;
	title: string;
	description: string | undefined;
	crumbs: readonly Crumb[];
}): string {
	const url = new URL(page.path, DOCS_ORIGIN).href;
	const graph = [
		{
			'@type': 'TechArticle',
			'@id': `${url}#article`,
			headline: page.title,
			...(page.description ? { description: page.description } : {}),
			url,
			mainEntityOfPage: url,
			inLanguage: 'en',
			isPartOf: { '@type': 'WebSite', name: 'SkillPouch Docs', url: `${DOCS_ORIGIN}/` },
			about: {
				'@type': 'SoftwareApplication',
				'@id': 'https://skillpouch.net/#software',
				name: 'SkillPouch',
				url: 'https://skillpouch.net/',
			},
			author: { '@type': 'Organization', name: 'SkillPouch', url: 'https://skillpouch.net/' },
			publisher: {
				'@type': 'Organization',
				'@id': 'https://skillpouch.net/#organization',
				name: 'SkillPouch',
			},
			image: OG_IMAGE,
		},
		{
			'@type': 'BreadcrumbList',
			itemListElement: page.crumbs.map((crumb, index) => ({
				'@type': 'ListItem',
				position: index + 1,
				name: crumb.name,
				item: new URL(crumb.path, DOCS_ORIGIN).href,
			})),
		},
	];
	return JSON.stringify({ '@context': 'https://schema.org', '@graph': graph }).replace(
		/</g,
		'\\u003c',
	);
}
