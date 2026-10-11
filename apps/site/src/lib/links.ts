// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The web app lives on its own host (`app.skillpouch.net`); links into it
 * are absolute. `PUBLIC_APP_URL` points them elsewhere, e.g. at a local
 * web app in development.
 */

export const DEFAULT_APP_URL = 'https://app.skillpouch.net';
export const DEV_APP_URL = 'http://localhost:5173';

/** The web app's origin, without a trailing slash. */
export function resolveAppUrl(configured: string | undefined, dev: boolean): string {
	const url = configured?.trim() || (dev ? DEV_APP_URL : DEFAULT_APP_URL);
	return url.replace(/\/+$/, '');
}

export const APP_URL = resolveAppUrl(import.meta.env.PUBLIC_APP_URL, import.meta.env.DEV);
export const SIGN_IN_URL = `${APP_URL}/sign-in`;
export const DOCS_URL = 'https://docs.skillpouch.net';
/** Public pricing, read from the app's API. */
export const PLANS_URL = `${APP_URL}/v1/plans`;
