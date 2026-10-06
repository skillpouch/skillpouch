// SPDX-License-Identifier: AGPL-3.0-only
/**
 * API process entrypoint (plan 06, 10 §5).
 *
 *   API_ROLE=api      serve HTTP (default)
 *   API_ROLE=migrate  apply pending migrations and exit (deploy step)
 *   API_ROLE=worker   see `worker.ts` (same image, different command)
 *
 * Graceful shutdown on SIGTERM/SIGINT (06 §8): `/readyz` turns 503 so the
 * proxy stops routing here, SSE clients get a jittered `reconnect`,
 * long-polls wake up, in-flight requests get `SHUTDOWN_GRACE_MS` to finish.
 */
import { migrate } from '@skillpouch/db';
import { loadEnv } from './config/env';
import { closeDeps, createDeps } from './deps';
import { createLogger } from './infra/logger';
import { Metrics } from './infra/metrics';
import { openStreams } from './modules/events/event-stream';
import { buildServer } from './server';
import { runWorker } from './worker';

const env = loadEnv();

if (env.API_ROLE === 'migrate') {
	const log = createLogger(env, 'migrate');
	const applied = await migrate({
		connectionString: env.MIGRATION_DATABASE_URL ?? env.DATABASE_URL,
		log: (message) => log.info(message),
	});
	log.info({ applied: applied.length }, 'migrations done');
	process.exit(0);
}

if (env.API_ROLE === 'worker') {
	await runWorker(env);
} else {
	const log = createLogger(env, 'api');
	const deps = await createDeps(env, log, 'api');
	await deps.hub.start();
	const metrics = new Metrics('api');
	const { app, health } = await buildServer(deps, { metrics });
	await app.listen({ host: env.HOST, port: env.PORT });
	const metricsServer =
		env.METRICS_PORT > 0 ? await metrics.listen('0.0.0.0', env.METRICS_PORT) : null;
	if (env.SWAGGER) log.info(`Swagger UI: ${env.API_PUBLIC_URL.replace(/\/+$/, '')}/docs`);

	let stopping = false;
	const shutdown = async (signal: string) => {
		if (stopping) return;
		stopping = true;
		log.info({ signal }, 'draining');
		health.draining = true;
		for (const stream of [...openStreams]) stream.drain();
		deps.hub.wakeAll();
		const timer = setTimeout(() => {
			log.error('grace period exceeded, exiting');
			process.exit(1);
		}, env.SHUTDOWN_GRACE_MS);
		timer.unref();
		await app.close();
		metricsServer?.close();
		await closeDeps(deps);
		log.info('stopped');
		process.exit(0);
	};
	process.on('SIGTERM', () => void shutdown('SIGTERM'));
	process.on('SIGINT', () => void shutdown('SIGINT'));
}
