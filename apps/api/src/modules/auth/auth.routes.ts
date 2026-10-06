// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Mounts Better Auth under `/v1/auth/*`: OAuth redirects and callbacks
 * (GitHub, Google), `get-session` and `sign-out`. Better Auth speaks the Fetch
 * API, so each request is converted to a `Request` and the `Response` copied
 * back — including every `Set-Cookie` header.
 */
import type { RouteHandlerMethod } from 'fastify';
import type { Deps } from '../../deps';
import type { ZodApp } from '../../http/zod-app';

export async function authRoutes(app: ZodApp, deps: Deps) {
	const handler: RouteHandlerMethod = async (request, reply) => {
		const url = new URL(request.url, deps.env.API_PUBLIC_URL);
		const headers = new Headers();
		for (const [key, value] of Object.entries(request.headers)) {
			if (value === undefined) continue;
			headers.set(key, Array.isArray(value) ? value.join(', ') : value);
		}
		const hasBody = request.method !== 'GET' && request.body !== undefined;
		const response = await deps.auth.handler(
			new Request(url, {
				method: request.method,
				headers,
				body: hasBody ? JSON.stringify(request.body) : null,
			}),
		);
		reply.status(response.status);
		for (const [key, value] of response.headers) {
			if (key === 'set-cookie') continue;
			reply.header(key, value);
		}
		const cookies = response.headers.getSetCookie();
		if (cookies.length > 0) reply.header('set-cookie', cookies);
		return reply.send(response.body ? Buffer.from(await response.arrayBuffer()) : null);
	};

	// Every page load reads the session: the roomy per-IP bucket, not the sign-in one.
	app.route({
		method: 'GET',
		url: '/v1/auth/get-session',
		config: { auth: 'public', rateLimit: 'public', raw: true },
		schema: { hide: true },
		handler,
	});
	// Sign-in, callbacks and sign-out: the tight `auth` bucket.
	app.route({
		method: ['GET', 'POST'],
		url: '/v1/auth/*',
		config: { auth: 'public', rateLimit: 'auth', raw: true },
		schema: { hide: true },
		handler,
	});
}
