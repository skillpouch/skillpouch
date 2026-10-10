// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import type { Me } from '@/lib/api/types';
import { sameMe } from '../use-me-sync';

describe('sameMe', () => {
	it('compares content, not object identity', () => {
		const me = { user: { id: 'u1', role: 'user' } } as unknown as Me;
		const copy = JSON.parse(JSON.stringify(me)) as Me;
		const other = { user: { id: 'u1', role: 'admin' } } as unknown as Me;
		expect(sameMe(me, copy)).toBe(true);
		expect(sameMe(me, other)).toBe(false);
		expect(sameMe(undefined, me)).toBe(false);
		expect(sameMe(undefined, undefined)).toBe(true);
	});
});
