// SPDX-License-Identifier: AGPL-3.0-only
/**
 * What search engines should index. The generated API reference has a page
 * per endpoint; those stay readable but are kept out of the sitemap and the
 * index so crawlers spend their time on the guides. The `/api/` overview stays.
 */

/** Shared with the site, until the docs have a card of their own. */
export const OG_IMAGE = 'https://skillpouch.net/og.jpg';

/** True for a generated endpoint page, given a path or a full URL. */
export function isApiOperation(pathOrUrl: string): boolean {
	const path = pathOrUrl.startsWith('http') ? new URL(pathOrUrl).pathname : pathOrUrl;
	return path.startsWith('/api/operations/');
}
