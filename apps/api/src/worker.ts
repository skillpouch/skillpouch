// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Background worker: the same codebase and image as the API,
 * started with `API_ROLE=worker`. pg-boss keeps schedules as singletons, so
 * any number of workers can run; every job is idempotent.
 */
import { PgBoss } from 'pg-boss';
import type { Env } from './config/env';
import { closeDeps, createDeps, type Deps } from './deps';
import { createLogger } from './infra/logger';
import { Metrics } from './infra/metrics';
import { JOBS, type JobDefinition } from './jobs/registry';

/** Runs one job with logging + metrics; rethrows so pg-boss records the failure and retries. */
export async function runJob(deps: Deps, job: JobDefinition, metrics?: Metrics): Promise<unknown> {
	const started = Date.now();
	try {
		const result = await job.run(deps);
		metrics?.jobRuns.labels(job.name, 'ok').inc();
		deps.log.info({ job: job.name, result, ms: Date.now() - started }, 'job done');
		return result;
	} catch (error) {
		metrics?.jobRuns.labels(job.name, 'failed').inc();
		deps.log.error({ job: job.name, err: error }, 'job failed');
		throw error;
	} finally {
		metrics?.jobDuration.labels(job.name).observe((Date.now() - started) / 1000);
	}
}

export async function startScheduler(deps: Deps, boss: PgBoss, metrics?: Metrics): Promise<void> {
	for (const job of JOBS) {
		await boss.createQueue(job.name);
		await boss.schedule(job.name, job.cron, null, { tz: 'UTC' });
		await boss.work(job.name, async () => {
			await runJob(deps, job, metrics);
		});
	}
}

export async function runWorker(env: Env): Promise<void> {
	const log = createLogger(env, 'worker');
	const deps = await createDeps(env, log, 'worker');
	const boss = new PgBoss({
		connectionString: env.JOBS_DATABASE_URL ?? env.MIGRATION_DATABASE_URL ?? env.DATABASE_URL,
		application_name: 'skillpouch-worker',
	});
	boss.on('error', (error) => log.error({ err: error }, 'pg-boss error'));
	await boss.start();
	const metrics = new Metrics('worker');
	await startScheduler(deps, boss, metrics);
	const metricsServer =
		env.METRICS_PORT > 0 ? await metrics.listen('0.0.0.0', env.METRICS_PORT) : null;
	log.info({ jobs: JOBS.length }, 'worker started');

	const shutdown = async () => {
		log.info('worker stopping');
		await boss.stop({ graceful: true, timeout: env.SHUTDOWN_GRACE_MS });
		metricsServer?.close();
		await closeDeps(deps);
		process.exit(0);
	};
	process.on('SIGTERM', () => void shutdown());
	process.on('SIGINT', () => void shutdown());
}
