// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { fromLegacyPath } from '../legacy-paths';

describe('fromLegacyPath', () => {
	it.each([
		['/app', '/pouches'],
		['/app/', '/pouches'],
		['/app/p/123', '/pouches/123'],
		['/app/p/123/conflicts', '/pouches/123/conflicts'],
		['/app/p/123/skills', '/pouches/123/skills'],
		['/app/account', '/account'],
		['/app/account/billing', '/account/billing'],
	])('%s → %s', (from, to) => {
		expect(fromLegacyPath(from)).toBe(to);
	});

	it('leaves other paths alone', () => {
		expect(fromLegacyPath('/pouches')).toBeNull();
		expect(fromLegacyPath('/apple')).toBeNull();
		expect(fromLegacyPath('/account')).toBeNull();
	});
});
