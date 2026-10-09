// SPDX-License-Identifier: AGPL-3.0-only
/** Token usage: computers report what their assistants used; anyone signed in reads the sum. */
import { z } from 'zod';
import type { Deps } from '../../deps';
import { deviceOf, principalOf } from '../../http/principal';
import type { ZodApp } from '../../http/zod-app';
import { reportUsage, usageSummary } from './usage.service';

const Count = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);

const Counts = z.object({
	input: Count,
	output: Count,
	cache_read: Count,
	cache_write: Count,
});

const UsageRow = Counts.extend({
	day: z.string().regex(/^20\d\d-\d\d-\d\d$/),
	assistant: z.string().regex(/^[a-z0-9-]{1,32}$/),
	model: z.string().min(1).max(120),
});

export async function usageRoutes(app: ZodApp, deps: Deps) {
	app.put(
		'/v1/usage/sources/:sourceId',
		{
			config: { auth: 'device' },
			schema: {
				tags: ['usage'],
				summary: 'Report the tokens this computer’s assistants used, per UTC day',
				description:
					'`sourceId` names the logs the counts come from and stays the same across logins. Rows are never added up: each keeps the larger of its stored and reported total, so sending the same logs again changes nothing.',
				params: z.object({ sourceId: z.string().regex(/^[0-9a-f]{32}$/) }),
				body: z.object({ rows: z.array(UsageRow).max(2000) }),
				response: { 200: z.object({ stored: z.number().int() }) },
			},
		},
		async (request) =>
			reportUsage(deps, deviceOf(request), request.params.sourceId, request.body.rows),
	);

	app.get(
		'/v1/usage',
		{
			config: { auth: 'any' },
			schema: {
				tags: ['usage'],
				summary: 'Tokens used by the account’s assistants, summed over its computers',
				response: {
					200: z.object({
						days: z.array(UsageRow),
						all_time: Counts,
						updated_at: z.string().nullable(),
					}),
				},
			},
		},
		async (request) => usageSummary(deps, principalOf(request)),
	);
}
