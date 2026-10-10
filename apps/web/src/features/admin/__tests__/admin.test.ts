// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { describeDetails } from '@/pages/admin/audit-page';
import {
	actorLabel,
	change,
	dayLabel,
	formatChange,
	grantEnd,
	isAdmin,
	statusTone,
} from '../admin';
import { bucket } from '../components/charts';

describe('admin helpers', () => {
	it('compares against the period before', () => {
		expect(formatChange(change(150, 100))).toBe('+50%');
		expect(formatChange(change(50, 100))).toBe('-50%');
		expect(formatChange(change(5, 0))).toBe('new');
		expect(formatChange(change(0, 0))).toBe('0%');
	});

	it('only admins are admins', () => {
		const me = (role: 'user' | 'admin') =>
			({ user: { role } }) as Parameters<typeof isAdmin>[0];
		expect(isAdmin(me('admin'))).toBe(true);
		expect(isAdmin(me('user'))).toBe(false);
		expect(isAdmin(undefined)).toBe(false);
	});

	it('labels days in UTC and statuses by tone', () => {
		expect(dayLabel('2026-10-03')).toBe('Oct 3');
		expect(statusTone('active')).toBe('success');
		expect(statusTone('past_due')).toBe('warn');
		expect(statusTone('refunded')).toBe('danger');
		expect(actorLabel('user:abc')).toBe('abc');
		expect(actorLabel('system')).toBe('system');
	});

	it('groups long ranges into fewer bars, keeping the sum', () => {
		const points = Array.from({ length: 365 }, (_, index) => ({
			label: `d${index}`,
			value: 1,
		}));
		const bars = bucket(points, 60);
		expect(bars.length).toBeLessThanOrEqual(60);
		expect(bars.reduce((sum, bar) => sum + bar.value, 0)).toBe(365);
		expect(bars[0]!.label).toBe('d0 – d6');
		expect(bucket(points.slice(0, 7), 60)).toHaveLength(7);
	});

	it('puts the reason first in audit details', () => {
		expect(describeDetails({ details: { reason: 'beta tester', role: 'admin' } })).toBe(
			'“beta tester” · role: admin',
		);
		expect(describeDetails({ details: {} })).toBe('—');
		expect(describeDetails({ details: { reason: '' } })).toBe('—');
	});

	it('works out when a given plan ends', () => {
		const now = new Date('2026-01-31T10:00:00Z');
		expect(grantEnd('forever', '', now)).toBeNull();
		expect(grantEnd('year', '', now)).toBe('2027-01-31T10:00:00.000Z');
		expect(grantEnd('date', '2026-06-01', now)).toBe('2026-06-01T23:59:59.000Z');
		expect(grantEnd('date', '', now)).toBeNull();
	});
});
