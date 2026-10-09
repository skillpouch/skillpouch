// SPDX-License-Identifier: AGPL-3.0-only
/** `GET /v1/cli/latest` answers with the version npm has, not a configured one. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CliReleases } from '../../src/modules/account/cli-release';
import { createHarness, type Harness } from '../helpers/harness';

describe('latest CLI', () => {
	let h: Harness;

	beforeAll(async () => {
		h = await createHarness(
			{},
			{
				configure: (deps) => {
					deps.cliReleases = new CliReleases((async () =>
						Response.json({ version: '1.4.2' })) as unknown as typeof fetch);
				},
			},
		);
	});
	afterAll(async () => {
		await h.close();
	});

	it('comes from npm', async () => {
		const response = await h.app.inject({ method: 'GET', url: '/v1/cli/latest' });
		expect(response.json().data).toEqual({ version: '1.4.2', min_supported: '0.1.0' });
	});
});
