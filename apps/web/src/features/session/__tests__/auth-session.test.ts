// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it, vi } from 'vitest';
import { RETRY_DELAYS_MS, SessionCheckFailed, readAuthSession } from '../auth-session';

const user = { user: { id: 'u1', email: 'ada@example.com' } };
const json = (body: unknown, status = 200) =>
	new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function fetcher(...answers: (Response | Error)[]) {
	const queue = [...answers];
	return vi.fn(async () => {
		const next = queue.shift()!;
		if (next instanceof Error) throw next;
		return next;
	}) as unknown as typeof fetch;
}

const noWait = async () => undefined;

describe('readAuthSession', () => {
	it('returns the user, or null when Better Auth says signed out', async () => {
		expect(await readAuthSession(fetcher(json(user)), noWait)).toEqual(user);
		expect(await readAuthSession(fetcher(json(null)), noWait)).toBeNull();
		expect(await readAuthSession(fetcher(json({}, 401)), noWait)).toBeNull();
	});

	it('waits out a restarting server instead of signing the user out', async () => {
		const fetch = fetcher(
			new Response('', { status: 502 }),
			new TypeError('offline'),
			json(user),
		);
		expect(await readAuthSession(fetch, noWait)).toEqual(user);
		expect(fetch).toHaveBeenCalledTimes(3);
	});

	it('gives up with an error, never with signed out', async () => {
		const failures = Array.from(
			{ length: RETRY_DELAYS_MS.length + 1 },
			() => new Response('', { status: 503 }),
		);
		await expect(readAuthSession(fetcher(...failures), noWait)).rejects.toBeInstanceOf(
			SessionCheckFailed,
		);
	});
});
