// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Every indexable page of the site, for the sitemap and the checks that keep
 * it complete. Paths end in a slash: that is the URL Cloudflare Pages serves
 * without a redirect, so canonicals and the sitemap use it too.
 */

export interface SitePage {
	path: string;
	/** Files (relative to `apps/site`) whose last commit dates the page. */
	sources: readonly string[];
}

export const SITE_PAGES: readonly SitePage[] = [
	{
		path: '/',
		sources: ['src/pages/index.astro', 'src/components', 'src/layouts'],
	},
	{
		path: '/about/',
		sources: ['src/pages/about.astro', 'src/components/landing-content.ts'],
	},
	{
		path: '/compare/',
		sources: ['src/pages/compare.astro'],
	},
	{
		path: '/faq/',
		sources: ['src/pages/faq.astro', 'src/components/landing-content.ts'],
	},
	{ path: '/terms/', sources: ['src/pages/terms.astro'] },
	{ path: '/privacy/', sources: ['src/pages/privacy.astro'] },
];

/** `about.astro` → `/about/`, `index.astro` → `/`. */
export function pagePath(file: string): string {
	const name = file.replace(/\.astro$/, '');
	return name === 'index' ? '/' : `/${name}/`;
}
