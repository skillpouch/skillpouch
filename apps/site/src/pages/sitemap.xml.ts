// SPDX-License-Identifier: AGPL-3.0-only
import type { APIRoute } from 'astro';
import { lastModified } from '@/lib/last-modified';
import { SITE_PAGES } from '@/lib/pages';
import { sitemapXml } from '@/lib/sitemap';

export const GET: APIRoute = ({ site }) =>
	new Response(
		sitemapXml(
			SITE_PAGES.map((page) => ({
				loc: new URL(page.path, site).href,
				lastmod: lastModified(page.sources),
			})),
		),
		{ headers: { 'Content-Type': 'application/xml; charset=utf-8' } },
	);
