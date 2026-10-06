// SPDX-License-Identifier: AGPL-3.0-only
/** `GET /v1/import/github/scan` (plan 16 §8). */
import { z } from 'zod';
import type { Deps } from '../../deps';
import { principalOf } from '../../http/principal';
import type { ZodApp } from '../../http/zod-app';
import { REF_PATTERN, REPO_PATTERN } from './github.service';

const ScanQuery = z.object({
	repo: z.string().regex(REPO_PATTERN, 'owner/name'),
	ref: z.string().regex(REF_PATTERN).optional(),
});

const ScanResponse = z.object({
	repo: z.string(),
	ref: z.string(),
	sha: z.string(),
	items: z.array(
		z.object({
			kind: z.enum(['skill', 'plugin', 'marketplace', 'instructions', 'mcp_server']),
			path: z.string(),
			name: z.string(),
			truncated: z.boolean(),
			files: z.array(
				z.object({ path: z.string(), size: z.number().int(), content_b64: z.string() }),
			),
		}),
	),
});

export async function importRoutes(app: ZodApp, deps: Deps) {
	app.get(
		'/v1/import/github/scan',
		{
			config: { auth: 'any' },
			schema: {
				tags: ['import'],
				summary:
					'Scan a public GitHub repo for skills, plugins, marketplaces, instructions and MCP manifests',
				description:
					'The server learns which public repository was scanned; the chosen items are encrypted and committed by the client.',
				querystring: ScanQuery,
				response: { 200: ScanResponse },
			},
		},
		async (request) => {
			principalOf(request);
			return deps.github.scan(request.query.repo, request.query.ref);
		},
	);
}
