// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The public site (landing page, Terms, Privacy) lives on its own host
 * (`skillpouch.net`). `VITE_SITE_URL` points links at another one, e.g. a
 * self-hosted site.
 */

export const DEFAULT_SITE_URL = 'https://skillpouch.net';
export const DEV_SITE_URL = 'http://localhost:4321';

/** The site's origin, without a trailing slash. */
export function resolveSiteUrl(configured: string | undefined, dev: boolean): string {
	const url = configured?.trim() || (dev ? DEV_SITE_URL : DEFAULT_SITE_URL);
	return url.replace(/\/+$/, '');
}

export const SITE_URL = resolveSiteUrl(
	import.meta.env.VITE_SITE_URL as string | undefined,
	import.meta.env.DEV,
);
export const TERMS_URL = `${SITE_URL}/terms`;
export const PRIVACY_URL = `${SITE_URL}/privacy`;
