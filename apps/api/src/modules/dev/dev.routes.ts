// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Development-only sign-in. Registered only when `DEV_LOGIN=true`, which the
 * environment loader refuses in production. It creates (or reuses) a user by
 * email and starts a normal Better Auth session, so everything after sign-in
 * — binding, unlock, E2EE — runs exactly as it does after OAuth.
 *
 * `POST /v1/dev/plan` switches the signed-in account to another plan through
 * the normal grant → entitlements path, so plan limits, locked pouches and
 * downgrades can be tried without a payment provider.
 */
import { planGrants, plans, users } from '@skillpouch/db';
import { makeSignature } from 'better-auth/crypto';
import { and, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';
import type { Deps } from '../../deps';
import { AppError } from '../../http/app-error';
import { sessionOf } from '../../http/principal';
import type { ZodApp } from '../../http/zod-app';
import { withTenantTx } from '../../security/tenant-tx';
import { refreshEntitlementsInTx } from '../entitlements/entitlements.service';

const DevPlanBody = z.strictObject({ plan_slug: z.string().min(1).max(64) });

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
	app.post(
		'/v1/dev/plan',
		{
			config: { auth: 'session' },
			schema: {
				tags: ['dev'],
				summary:
					'Development only: move the signed-in account to a plan (default plan = no grant)',
				body: DevPlanBody,
				response: { 200: z.object({ plan_slug: z.string() }) },
			},
		},
		async (request) => {
			const principal = sessionOf(request);
			const [plan] = await deps.db.app
				.select()
				.from(plans)
				.where(eq(plans.slug, request.body.plan_slug));
			if (!plan) throw new AppError('not_found', { reason: 'plan' });
			const effective = await withTenantTx(
				deps.db.app,
				principal.storageAccountId,
				async (tx) => {
					await tx
						.update(planGrants)
						.set({ revokedAt: deps.now() })
						.where(
							and(
								eq(planGrants.storageAccountId, principal.storageAccountId),
								isNull(planGrants.revokedAt),
							),
						);
					if (!plan.isDefault) {
						await tx.insert(planGrants).values({
							storageAccountId: principal.storageAccountId,
							planId: plan.id,
							reason: 'dev',
							grantedBy: principal.userId,
						});
					}
					return refreshEntitlementsInTx(tx, principal.storageAccountId, deps.now());
				},
			);
			return { plan_slug: effective.plan_slug };
		},
	);
}
