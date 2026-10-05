// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Liveness and readiness (plan 10 §5.1). Not wrapped in the envelope
 * (documented exception, 17 §2). `/readyz` returns 503 while draining so the
 * proxy stops routing new requests to this replica.
 */
import { loadMigrations } from '@skillpouch/db';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import type { Deps } from '../../deps';
import { rawSchema } from '../../http/serialization';
import type { ZodApp } from '../../http/zod-app';

export interface HealthState {
	draining: boolean;
}

export async function healthRoutes(app: ZodApp, deps: Deps, state: HealthState) {
	const expectedSchema = loadMigrations().length;

	app.get(
		'/healthz',
		{
			config: { auth: 'public', raw: true },
			schema: { tags: ['health'], response: { 200: rawSchema(z.object({ status: z.literal('ok') })) } },
		},
		async () => ({ status: 'ok' as const }),
	);

	app.get(
		'/readyz',
		{
			config: { auth: 'public', raw: true },
			schema: {
				tags: ['health'],
				response: {
					200: rawSchema(z.object({ status: z.literal('ready'), schema_version: z.number() })),
					503: rawSchema(z.object({ status: z.string(), schema_version: z.number().nullable() })),
				},
			},
		},
		async (_request, reply) => {
			if (state.draining) return reply.code(503).send({ status: 'draining', schema_version: null });
			try {
				const result = await deps.db.app.execute(sql`SELECT count(*)::int AS n FROM schema_migrations`);
				const version = Number(result.rows[0]?.n ?? 0);
				if (version < expectedSchema) {
					return reply.code(503).send({ status: 'schema_behind', schema_version: version });
				}
				return { status: 'ready' as const, schema_version: version };
			} catch {
				return reply.code(503).send({ status: 'database_unavailable', schema_version: null });
			}
		},
	);
}
