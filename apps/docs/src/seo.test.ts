// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { isApiOperation } from './seo';

describe('isApiOperation', () => {
	it('matches generated endpoint pages, by path or full URL', () => {
		expect(isApiOperation('/api/operations/v1adminusersidsuspend/')).toBe(true);
		expect(
			isApiOperation('https://docs.skillpouch.net/api/operations/v1billingwebhookspolar/'),
		).toBe(true);
	});

	it('keeps the API overview and the guides', () => {
		expect(isApiOperation('/api/')).toBe(false);
		expect(isApiOperation('https://docs.skillpouch.net/api/')).toBe(false);
		expect(isApiOperation('https://docs.skillpouch.net/getting-started/second-computer/')).toBe(
			false,
		);
	});
});
