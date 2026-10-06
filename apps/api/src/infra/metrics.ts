// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Prometheus metrics (plan 06 §8, 10 §8), served on an internal port that
 * the reverse proxy never exposes. Route labels use the route *pattern*
 * (`/v1/pouches/:pouchId/operations`), never raw URLs, so cardinality is
 * bounded and no IDs leak into metrics.
 */
import { createServer, type Server } from 'node:http';
import type { FastifyInstance } from 'fastify';
import { Counter, Histogram, Registry, collectDefaultMetrics } from 'prom-client';

export class Metrics {
	readonly registry = new Registry();
	readonly httpDuration = new Histogram({
		name: 'skillpouch_http_request_duration_seconds',
		help: 'HTTP request duration by route and status class',
		labelNames: ['method', 'route', 'status'] as const,
		buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 30],
		registers: [this.registry],
	});
	readonly jobRuns = new Counter({
		name: 'skillpouch_job_runs_total',
		help: 'Background job runs by job and outcome',
		labelNames: ['job', 'outcome'] as const,
		registers: [this.registry],
	});
	readonly jobDuration = new Histogram({
		name: 'skillpouch_job_duration_seconds',
		help: 'Background job duration',
		labelNames: ['job'] as const,
		buckets: [0.1, 0.5, 1, 5, 15, 60, 300],
		registers: [this.registry],
	});

	constructor(role: string) {
		this.registry.setDefaultLabels({ role });
		collectDefaultMetrics({ register: this.registry });
	}

	/** Records every response of `app`. */
	instrument(app: FastifyInstance): void {
		app.addHook('onResponse', async (request, reply) => {
			const route = request.routeOptions.url ?? 'unmatched';
			this.httpDuration
				.labels(request.method, route, `${Math.floor(reply.statusCode / 100)}xx`)
				.observe(reply.elapsedTime / 1000);
		});
	}

	/** Starts the internal `/metrics` listener. */
	listen(host: string, port: number): Promise<Server> {
		const server = createServer(async (request, response) => {
			if (request.url !== '/metrics') {
				response.writeHead(404).end();
				return;
			}
			response.writeHead(200, { 'Content-Type': this.registry.contentType });
			response.end(await this.registry.metrics());
		});
		return new Promise((resolve) => server.listen(port, host, () => resolve(server)));
	}
}
