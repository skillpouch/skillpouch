// SPDX-License-Identifier: AGPL-3.0-only
/** Rate limits: public routes are limited per IP, health probes never are. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BUCKETS } from '../../src/security/rate-limit';
import { createHarness, type Harness } from '../helpers/harness';

describe('rate limits', () => {
	let h: Harness;

	beforeAll(async () => {
		h = await createHarness({ RATE_LIMIT_ENABLED: 'true' });
	});
	afterAll(async () => {
		await h.close();
	});

	const get = (url: string) => h.app.inject({ method: 'GET', url });

	it('public share links answer 429 once the per-IP bucket is empty', async () => {
		const url = '/v1/public/shares/0192f0c4-1111-7000-8000-000000000001';
		let limited = 0;
		// Extra requests beyond capacity: the bucket refills while the loop runs.
		for (let index = 0; index < BUCKETS.public.capacity + 40; index++) {
			const response = await get(url);
			if (response.statusCode === 429) {
				limited += 1;
				expect(response.headers['retry-after']).toBeDefined();
			} else expect(response.statusCode).toBe(404);
		}
		expect(limited).toBeGreaterThanOrEqual(5);
	});

	it('health probes are never limited', async () => {
		for (let index = 0; index < BUCKETS.public.capacity + 5; index++) {
			expect((await get('/healthz')).statusCode).toBe(200);
		}
	});

	it('GitHub scans have their own small bucket', () => {
		expect(BUCKETS.import.capacity).toBeLessThanOrEqual(10);
	});
});
