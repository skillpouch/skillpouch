// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Development-only sign-in. Registered only when `DEV_LOGIN=true`, which the
 * environment loader refuses in production. It creates (or reuses) a user by
 * email and starts a normal Better Auth session, so everything after sign-in
 * — binding, unlock, E2EE — runs exactly as it does after OAuth.
 */
import { users } from '@skillpouch/db';
import { makeSignature } from 'better-auth/crypto';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import type { Deps } from '../../deps';
import type { ZodApp } from '../../http/zod-app';

const DevLoginBody = z.strictObject({
	email: z.email().max(254),
	name: z.string().trim().min(1).max(64).optional(),
});

interface AuthInternals {
	secret: string;
	authCookies: {
		sessionToken: {
			name: string;
			attributes: { path?: string; sameSite?: string; secure?: boolean; maxAge?: number };
		};
	};
	internalAdapter: {
		createUser(user: Record<string, unknown>): Promise<{ id: string }>;
		createSession(userId: string): Promise<{ token: string }>;
	};
}

export async function devRoutes(app: ZodApp, deps: Deps) {
	if (!deps.env.DEV_LOGIN || deps.env.NODE_ENV === 'production') return;

	app.post(
		'/v1/dev/login',
		{
			config: { auth: 'public', rateLimit: 'auth' },
			schema: {
				tags: ['dev'],
				summary: 'Development only: sign in by email without OAuth',
				body: DevLoginBody,
				response: { 200: z.object({ user_id: z.string() }) },
			},
		},
		async (request, reply) => {
			const ctx = (await deps.auth.$context) as unknown as AuthInternals;
			const email = request.body.email.toLowerCase();
			const [existing] = await deps.db.app
				.select({ id: users.id })
				.from(users)
				.where(eq(users.email, email));
			const userId =
				existing?.id ??
				(
					await ctx.internalAdapter.createUser({
						email,
						name: request.body.name ?? email.split('@')[0],
						emailVerified: true,
					})
				).id;
			const session = await ctx.internalAdapter.createSession(userId);
			const cookie = ctx.authCookies.sessionToken;
			const value = `${session.token}.${await makeSignature(session.token, ctx.secret)}`;
			const attributes = [
				`${cookie.name}=${encodeURIComponent(value)}`,
				`Path=${cookie.attributes.path ?? '/'}`,
				'HttpOnly',
				`SameSite=${cookie.attributes.sameSite ?? 'Lax'}`,
			];
			if (cookie.attributes.maxAge) attributes.push(`Max-Age=${cookie.attributes.maxAge}`);
			if (cookie.attributes.secure) attributes.push('Secure');
			reply.header('set-cookie', attributes.join('; '));
			return { user_id: userId };
		},
	);
}
