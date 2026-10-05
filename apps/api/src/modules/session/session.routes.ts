// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Browser session binding (plan 08 §5.2) and DPoP nonces (08 §3.2).
 *
 * After OAuth sign-in the web app creates a non-extractable P-256 key and
 * calls `POST /v1/session/bind` with a DPoP proof made by it. From then on a
 * cookie alone is useless: every request must also carry a proof from that key.
 */
import { NonceResponse, SessionBindResponse } from '@skillpouch/contracts';
import { sessions } from '@skillpouch/db';
import { and, eq, isNull } from 'drizzle-orm';
import type { Deps } from '../../deps';
import { AppError } from '../../http/app-error';
import { sessionOf } from '../../http/principal';
import type { ZodApp } from '../../http/zod-app';
import { verifyRequestDpop } from '../../security/authenticate';

export async function sessionRoutes(app: ZodApp, deps: Deps) {
	app.get(
		'/v1/dpop/nonce',
		{
			config: { auth: 'public' },
			schema: { tags: ['session'], summary: 'Current DPoP nonce', response: { 200: NonceResponse } },
		},
		async () => ({ nonce: deps.nonces.current() }),
	);

	app.post(
		'/v1/session/bind',
		{
			config: { auth: 'session', allowUnbound: true },
			schema: {
				tags: ['session'],
				summary: 'Bind this web session to the browser key that signed the DPoP proof',
				response: { 200: SessionBindResponse },
			},
		},
		async (request) => {
			const principal = sessionOf(request);
			if (principal.jkt) throw new AppError('session_already_bound');
			const { jkt } = await verifyRequestDpop(deps, request);
			const updated = await deps.db.app
				.update(sessions)
				.set({ jkt, updatedAt: new Date() })
				.where(and(eq(sessions.id, principal.sessionId), isNull(sessions.jkt)))
				.returning({ id: sessions.id });
			if (updated.length === 0) throw new AppError('session_already_bound');
			return { jkt };
		},
	);
}
