// SPDX-License-Identifier: AGPL-3.0-only
/**
 * OpenAPI 3.1 generated from the Zod route schemas. The spec is always built
 * (it feeds `packages/contracts/generated/openapi.json` and the CLI client);
 * the interactive Swagger UI at `/docs` is served only when `SWAGGER=true`
 * (default outside production).
 */
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import type { FastifyInstance } from 'fastify';
import type { Env } from '../config/env';
import { envelopeJsonSchemaTransform } from './serialization';

export async function registerSwagger(app: FastifyInstance, env: Env): Promise<void> {
	await app.register(swagger, {
		openapi: {
			openapi: '3.1.0',
			info: {
				title: 'SkillPouch API',
				version: '1.0.0',
				description: [
					'End-to-end encrypted sync for AI harness skills and instructions.',
					'',
					'Every JSON response uses the envelope `{ ok, data | error, meta }` (plan 17 §2).',
					'Error codes: https://docs.skillpouch.net/errors.',
					'',
					'**Authentication.** CLI devices send `Authorization: DPoP <access token>` plus a',
					'`DPoP` proof (RFC 9449) signed by the device key. Browsers use the session cookie',
					'plus a DPoP proof from the key bound with `POST /v1/session/bind`, and send',
					'`Skillpouch-Client: web` on writes. Fetch a nonce from `GET /v1/dpop/nonce`.',
				].join('\n'),
				license: { name: 'AGPL-3.0-only', url: 'https://www.gnu.org/licenses/agpl-3.0.html' },
			},
			servers: [{ url: env.API_PUBLIC_URL }],
			components: {
				securitySchemes: {
					dpop: { type: 'http', scheme: 'DPoP', description: 'DPoP-bound access token + DPoP proof' },
					session: { type: 'apiKey', in: 'cookie', name: 'sp.session_token' },
				},
			},
			tags: [
				{ name: 'health' },
				{ name: 'session', description: 'Browser session binding and DPoP nonces' },
				{ name: 'cli-auth', description: '“Authorize CLI” login (08 §6)' },
				{ name: 'devices', description: 'CLIs and browsers, refresh, revoke' },
				{ name: 'account', description: 'Me, roster (E2EE membership), key envelopes, join requests' },
				{ name: 'pouches' },
				{ name: 'sync', description: 'Blobs, operations, events, snapshots' },
				{ name: 'artifacts' },
				{ name: 'billing' },
				{ name: 'admin' },
			],
		},
		transform: envelopeJsonSchemaTransform,
	});

	if (env.SWAGGER) {
		await app.register(swaggerUi, { routePrefix: '/docs' });
	}
}
