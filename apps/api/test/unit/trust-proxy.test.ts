// SPDX-License-Identifier: AGPL-3.0-only
/** Behind the proxy, `request.ip` is what the proxy saw — not what the client claims. */
import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import { trustOneProxyHop, trustProxyHops } from '../../src/server';

describe('trusted proxy hops', () => {
	it('uses the last X-Forwarded-For entry and ignores the ones the client wrote', async () => {
		const app = Fastify({ trustProxy: trustOneProxyHop });
		app.get('/', async (request) => ({ ip: request.ip }));
		const response = await app.inject({
			url: '/',
			remoteAddress: '172.18.0.5',
			headers: { 'x-forwarded-for': '6.6.6.6, 203.0.113.7' },
		});
		expect(response.json()).toEqual({ ip: '203.0.113.7' });
		await app.close();
	});

	it('behind Cloudflare Tunnel + Caddy, trusts two hops and no more', async () => {
		const app = Fastify({ trustProxy: trustProxyHops(2) });
		app.get('/', async (request) => ({ ip: request.ip }));
		const response = await app.inject({
			url: '/',
			remoteAddress: '172.18.0.5',
			headers: { 'x-forwarded-for': '6.6.6.6, 203.0.113.7, 172.18.0.1' },
		});
		expect(response.json()).toEqual({ ip: '203.0.113.7' });
		await app.close();
	});
});
