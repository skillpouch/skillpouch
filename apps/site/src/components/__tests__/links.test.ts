// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { DEFAULT_APP_URL, DEV_APP_URL, resolveAppUrl } from '@/lib/links';

describe('app links', () => {
	it('point at the hosted app, or the local one in development', () => {
		expect(resolveAppUrl(undefined, false)).toBe(DEFAULT_APP_URL);
		expect(resolveAppUrl('', false)).toBe(DEFAULT_APP_URL);
		expect(resolveAppUrl(undefined, true)).toBe(DEV_APP_URL);
	});

	it('follow the configured origin without a trailing slash', () => {
		expect(resolveAppUrl('https://pouch.example.com/', false)).toBe(
			'https://pouch.example.com',
		);
		expect(resolveAppUrl(' http://localhost:15173 ', true)).toBe('http://localhost:15173');
	});
});
