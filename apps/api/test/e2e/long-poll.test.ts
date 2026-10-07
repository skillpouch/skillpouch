// SPDX-License-Identifier: AGPL-3.0-only
/**
 * An idle long-poll over a real socket holds until `wait` runs out. If it
 * returned early, every daemon would spin in a tight request loop.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { authorizeCli, setupAccount, type Account } from '../helpers/flows';
import { createHarness, type Harness } from '../helpers/harness';
import type { CliClient } from '../helpers/clients';
import { pouchState } from '../helpers/sync';

describe('long-poll over a real socket', () => {
	let h: Harness;
	let alice: Account;
	let cli: CliClient;

	beforeAll(async () => {
		h = await createHarness({}, { listen: true });
		alice = await setupAccount(h, 'alice@skillpouch.test');
		cli = await authorizeCli(h, alice);
	});
	afterAll(async () => {
		await h.close();
	});

	it('waits the full `wait` when nothing happens', async () => {
		const { epoch, event_seq } = await pouchState(cli, alice.pouchId);
		const started = Date.now();
		const response = await cli.get(
			`/v1/pouches/${alice.pouchId}/events?after=${event_seq}&epoch=${epoch}&wait=2`,
		);
		expect(response.status).toBe(200);
		expect(response.body.data.events).toEqual([]);
		expect(Date.now() - started).toBeGreaterThanOrEqual(1900);
	});
});
