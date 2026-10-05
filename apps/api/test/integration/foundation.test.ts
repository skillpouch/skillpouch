// SPDX-License-Identifier: AGPL-3.0-only
/** Envelope, error handling, health, swagger and route registration (06, 17). */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHarness, type Harness } from '../helpers/harness';

describe('HTTP foundation', () => {
	let h: Harness;
	beforeAll(async () => {
		h = await createHarness();
	});
	afterAll(async () => {
		await h.close();
	});

	it('serves liveness and readiness without the envelope', async () => {
		const health = await h.app.inject({ method: 'GET', url: '/healthz' });
		expect(health.json()).toEqual({ status: 'ok' });
		const ready = await h.app.inject({ method: 'GET', url: '/readyz' });
		expect(ready.statusCode).toBe(200);
		expect(ready.json().status).toBe('ready');
	});

	it('wraps successful JSON in the envelope with a request id', async () => {
		const response = await h.app.inject({ method: 'GET', url: '/v1/dpop/nonce' });
		const body = response.json();
		expect(body.ok).toBe(true);
		expect(typeof body.data.nonce).toBe('string');
		expect(body.meta.request_id).toBe(response.headers['skillpouch-request-id']);
		expect(response.headers['dpop-nonce']).toBeTruthy();
	});

	it('returns registry errors for unknown routes', async () => {
		const response = await h.app.inject({ method: 'GET', url: '/v1/nope' });
		expect(response.statusCode).toBe(404);
		expect(response.json()).toMatchObject({
			ok: false,
			error: {
				code: 'not_found',
				status: 404,
				retryable: false,
				docs_url: 'https://docs.skillpouch.net/errors/not_found',
			},
		});
	});

	it('rejects unauthenticated access with the envelope', async () => {
		const response = await h.app.inject({ method: 'GET', url: '/v1/pouches' });
		expect(response.statusCode).toBe(401);
		expect(response.json().error.code).toBe('unauthenticated');
	});

	it('honours a safe incoming x-request-id', async () => {
		const response = await h.app.inject({
			method: 'GET',
			url: '/v1/dpop/nonce',
			headers: { 'x-request-id': 'trace_12345678' },
		});
		expect(response.json().meta.request_id).toBe('trace_12345678');
	});

	it('publishes an OpenAPI document and the Swagger UI in dev/test', async () => {
		const spec = await h.app.inject({ method: 'GET', url: '/docs/json' });
		expect(spec.statusCode).toBe(200);
		const doc = spec.json();
		expect(doc.openapi).toBe('3.1.0');
		expect(Object.keys(doc.paths)).toContain('/v1/pouches');
		const ui = await h.app.inject({ method: 'GET', url: '/docs/' });
		expect(ui.statusCode).toBe(200);
	});

	it('declares config.auth on every registered route', () => {
		const routes = h.app.printRoutes({ commonPrefix: false });
		expect(routes).toContain('/v1/pouches');
	});
});
