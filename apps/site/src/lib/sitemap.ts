// SPDX-License-Identifier: AGPL-3.0-only
/** The XML sitemap (https://www.sitemaps.org/protocol.html). */

export interface SitemapEntry {
	loc: string;
	/** W3C datetime; left out when unknown. */
	lastmod?: string | undefined;
}

const escapeXml = (text: string) => text.replace(/[<>&'"]/g, (char) => `&#${char.charCodeAt(0)};`);

export function sitemapXml(entries: readonly SitemapEntry[]): string {
	const urls = entries.map(({ loc, lastmod }) =>
		lastmod
			? `\t<url><loc>${escapeXml(loc)}</loc><lastmod>${escapeXml(lastmod)}</lastmod></url>`
			: `\t<url><loc>${escapeXml(loc)}</loc></url>`,
	);
	return [
		'<?xml version="1.0" encoding="UTF-8"?>',
		'<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
		...urls,
		'</urlset>',
		'',
	].join('\n');
}
