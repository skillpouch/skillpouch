// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it, vi } from 'vitest';
import { CliReleases } from '../../src/modules/account/cli-release';

function registry(...answers: (string | null)[]) {
	return vi.fn(async () => {
		const version = answers.shift();
		if (version === null || version === undefined) return new Response('down', { status: 503 });
		return Response.json({ name: 'skillpouch', version });
	});
}

describe('CliReleases', () => {
	it('reads the latest version from npm and caches it', async () => {
		let now = 0;
		const http = registry('0.2.0', '0.3.0');
		const releases = new CliReleases(http as unknown as typeof fetch, () => now);
		expect(await releases.latest()).toBe('0.2.0');
		expect(await releases.latest()).toBe('0.2.0');
		expect(http).toHaveBeenCalledTimes(1);

		now += 16 * 60_000;
		await releases.latest();
		await vi.waitFor(async () => expect(await releases.latest()).toBe('0.3.0'));
		expect(http).toHaveBeenCalledTimes(2);
	});

	it('keeps the last known version while npm is down, and is null before it ever answered', async () => {
		let now = 0;
		const http = registry(null, '0.4.0', null);
		const releases = new CliReleases(http as unknown as typeof fetch, () => now);
		expect(await releases.latest()).toBeNull();
		now += 61_000;
		expect(await releases.latest()).toBe('0.4.0');
		now += 16 * 60_000;
		expect(await releases.latest()).toBe('0.4.0');
	});

	it('ignores answers that are not a version', async () => {
		const http = vi.fn(async () => Response.json({ version: '<script>' }));
		const releases = new CliReleases(http as unknown as typeof fetch, () => 0);
		expect(await releases.latest()).toBeNull();
	});
});
