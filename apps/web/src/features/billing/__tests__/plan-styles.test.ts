// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { cheapestPaidPlan } from '../billing';
import { PLAN_STYLES, planStyle } from '../plan-styles';
import type { PlanRecord } from '@/lib/api/types';

describe('planStyle', () => {
	it('has no style for free plans', () => {
		expect(planStyle('free')).toBeNull();
		expect(planStyle(null)).toBeNull();
		expect(planStyle('supporter', false)).toBeNull();
	});

	it('picks the style registered for the slug', () => {
		expect(planStyle('supporter')?.id).toBe('supporter');
		expect(planStyle('supporter-plus')?.id).toBe('supporter-plus');
	});

	it('gives unknown paid plans the first style', () => {
		expect(planStyle('team')).toBe(PLAN_STYLES[0]);
	});

	it('maps every slug to one style only', () => {
		const slugs = PLAN_STYLES.flatMap((style) => style.slugs);
		expect(new Set(slugs).size).toBe(slugs.length);
	});
});

describe('cheapestPaidPlan', () => {
	const plan = (slug: string, price_cents: number) => ({ slug, price_cents }) as PlanRecord;

	it('skips free plans and picks the lowest price', () => {
		const plans = [plan('free', 0), plan('supporter-plus', 1000), plan('supporter', 500)];
		expect(cheapestPaidPlan(plans)?.slug).toBe('supporter');
	});

	it('is undefined without paid plans', () => {
		expect(cheapestPaidPlan([plan('free', 0)])).toBeUndefined();
		expect(cheapestPaidPlan(undefined)).toBeUndefined();
	});
});
