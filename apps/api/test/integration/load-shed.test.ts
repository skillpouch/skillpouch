// SPDX-License-Identifier: AGPL-3.0-only
/** Load shedding: a lagging event loop answers 503 `server_busy` at once; health probes still pass. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHarness, type Harness } from '../helpers/harness';

function blockEventLoop(ms: number): void {
	const until = Date.now() + ms;
	while (Date.now() < until) {
		// Busy wait: simulates a saturated CPU.
	}
}

describe('load shedding', () => {
	let h: Harness;

	beforeAll(async () => {
		h = await createHarness({ LOAD_SHED_LAG_MS: '100' });
	});
	afterAll(async () => {
		await h.close();
	});

	it('sheds requests while the loop lags, keeps health probes, then recovers', async () => {
		blockEventLoop(1200);
		await new Promise((resolve) => setTimeout(resolve, 20));
		const busy = await h.app.inject({ method: 'GET', url: '/v1/plans' });
		expect(busy.statusCode).toBe(503);
		expect(busy.json().error.code).toBe('server_busy');
		expect(Number(busy.headers['retry-after'])).toBeGreaterThanOrEqual(2);
		expect((await h.app.inject({ method: 'GET', url: '/healthz' })).statusCode).toBe(200);

		await new Promise((resolve) => setTimeout(resolve, 1200));
		const after = await h.app.inject({ method: 'GET', url: '/v1/plans' });
		expect(after.statusCode).not.toBe(503);
	});
});
