// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { dayRange } from '../../src/modules/admin/admin-analytics';
import { normalizePolarPayment } from '../../src/modules/billing/polar';

describe('dayRange', () => {
	it('ends today (UTC) and crosses months', () => {
		expect(dayRange(new Date('2026-03-02T23:30:00Z'), 4)).toEqual([
			'2026-02-27',
			'2026-02-28',
			'2026-03-01',
			'2026-03-02',
		]);
	});
});

describe('normalizePolarPayment', () => {
	it('keeps what was paid, earned, taxed and refunded', () => {
		expect(
			normalizePolarPayment({
				id: 'ord_1',
				created_at: '2026-10-01T00:00:00Z',
				status: 'partially_refunded',
				total_amount: 600,
				net_amount: 500,
				tax_amount: 100,
				refunded_amount: 300,
				currency: 'USD',
				product_id: 'prod_1',
				customer: { external_id: 'acct' },
			}),
		).toEqual({
			id: 'ord_1',
			storageAccountId: 'acct',
			productId: 'prod_1',
			status: 'partially_refunded',
			currency: 'usd',
			amountCents: 600,
			netCents: 500,
			taxCents: 100,
			refundedCents: 300,
			createdAt: new Date('2026-10-01T00:00:00Z'),
		});
	});

	it('works out the net amount when Polar leaves it out', () => {
		const payment = normalizePolarPayment({ id: 'o', total_amount: 500, tax_amount: 50 });
		expect(payment.netCents).toBe(450);
		expect(payment.storageAccountId).toBeNull();
	});
});
