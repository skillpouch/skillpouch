// SPDX-License-Identifier: AGPL-3.0-only
/** `POST /v1/pouches/:pouchId/operations` — commit (plan 04 §3). */
import { CommitRequest, CommitResponse, PouchParam, canonicalDigest } from '@skillpouch/contracts';
import type { Deps } from '../../deps';
import { principalOf } from '../../http/principal';
import type { ZodApp } from '../../http/zod-app';
import { touchDevice } from '../../security/authenticate';
import { verifyDetachedSignature } from '../../security/request-signature';
import { commitOperations } from './operations.service';

export async function operationsRoutes(app: ZodApp, deps: Deps) {
	app.post(
		'/v1/pouches/:pouchId/operations',
		{
			config: { auth: 'any', rateLimit: 'operations' },
			bodyLimit: 30 * 1024 * 1024,
			schema: {
				tags: ['sync'],
				summary:
					'Commit 1–50 signed, encrypted operations (optimistic concurrency on revision ids)',
				description:
					'CLI devices must also send `Skillpouch-Signature`: a detached ES256 JWS over base64url(BLAKE3(canonical JSON body)).',
				params: PouchParam,
				body: CommitRequest,
				response: { 200: CommitResponse },
			},
		},
		async (request) => {
			const principal = principalOf(request);
			let signature: string | null = null;
			if (principal.kind === 'device') {
				await touchDevice(deps, principal);
				const header = request.headers['skillpouch-signature'];
				signature = await verifyDetachedSignature(
					typeof header === 'string' ? header : undefined,
					canonicalDigest(request.body),
					principal.publicJwk,
				);
			}
			return commitOperations(deps, principal, {
				pouchId: request.params.pouchId,
				request: request.body,
				signature,
			});
		},
	);
}
