// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Load shedding. When the event loop falls behind (CPU saturated), new
 * requests are answered at once with 503 `server_busy` and a jittered
 * Retry-After instead of queueing until every request times out. Health
 * probes, open streams and long-polls already in flight are unaffected.
 */
import { monitorEventLoopDelay } from 'node:perf_hooks';
import type { FastifyInstance } from 'fastify';
import { AppError } from './app-error';

const SAMPLE_MS = 500;

export function registerLoadShedding(app: FastifyInstance, maxLagMs: number): void {
	if (maxLagMs <= 0) return;
	const histogram = monitorEventLoopDelay({ resolution: 20 });
	histogram.enable();
	let lagMs = 0;
	const timer = setInterval(() => {
		lagMs = histogram.mean / 1e6;
		histogram.reset();
	}, SAMPLE_MS);
	timer.unref();

	app.addHook('onRequest', async (request) => {
		if (lagMs <= maxLagMs || request.routeOptions.config?.rateLimit === false) return;
		throw new AppError('server_busy', undefined, {
			headers: { 'Retry-After': String(2 + Math.floor(Math.random() * 4)) },
		});
	});
	app.addHook('onClose', async () => {
		clearInterval(timer);
		histogram.disable();
	});
}
