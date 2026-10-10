// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { DEFAULT_SITE_URL, DEV_SITE_URL, resolveSiteUrl } from '../site';

describe('site links', () => {
	it('point at the public site, or the local one in development', () => {
		expect(resolveSiteUrl(undefined, false)).toBe(DEFAULT_SITE_URL);
		expect(resolveSiteUrl('', false)).toBe(DEFAULT_SITE_URL);
		expect(resolveSiteUrl(undefined, true)).toBe(DEV_SITE_URL);
	});

	it('follow the configured origin without a trailing slash', () => {
		expect(resolveSiteUrl('https://pouch.example.com/', false)).toBe(
			'https://pouch.example.com',
		);
	});
});
