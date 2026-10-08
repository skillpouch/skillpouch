// SPDX-License-Identifier: AGPL-3.0-only
/** Reading a plan from a Polar product: slug, price and the metadata flags. */
import { describe, expect, it } from 'vitest';
import { planProductFromPolar } from '../../src/modules/billing/polar';

const product = (metadata: Record<string, unknown>) => ({
	id: 'prod_1',
	name: 'Friends Pass',
	recurring_interval: 'month',
	is_archived: false,
	metadata: { plan: 'friends-pass', ...metadata },
	prices: [{ amount_type: 'fixed', price_amount: 100, price_currency: 'USD' }],
});

describe('planProductFromPolar', () => {
	it('reads the plan slug, price and limits', () => {
		expect(
			planProductFromPolar(product({ pouch_limit: '20', storage_bytes: 1024 })),
		).toMatchObject({
			productId: 'prod_1',
			slug: 'friends-pass',
			priceCents: 100,
			currency: 'usd',
			pouchLimit: 20,
			storageBytes: 1024,
			visible: true,
		});
	});

	it.each([0, '0', ' 0 ', false, 'false', 'FALSE'])('visible=%j hides the plan', (visible) => {
		expect(planProductFromPolar(product({ visible }))?.visible).toBe(false);
	});

	it.each([1, '1', true, 'yes', ''])('visible=%j shows the plan', (visible) => {
		expect(planProductFromPolar(product({ visible }))?.visible).toBe(true);
	});

	it('ignores products without a plan tag', () => {
		expect(planProductFromPolar(product({ plan: undefined }))).toBeNull();
	});
});
