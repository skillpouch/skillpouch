// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Better Auth: GitHub + Google OAuth and web sessions. No
 * passwords, no 2FA, no device-authorization plugin — CLI login is our own
 * `cli-auth` module.
 *
 * Hooks:
 *  - user created  → storage account with the default plan;
 *  - session created → `step_up_at = now` (every new session is a fresh OAuth
 *    sign-in, which is exactly what step-up requires), and admin
 *    bootstrap from ADMIN_EMAILS for verified emails.
 */
import { accounts, sessions, users, verifications, type Database } from '@skillpouch/db';
import { betterAuth, type BetterAuthPlugin } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { testUtils } from 'better-auth/plugins';
import { eq, sql } from 'drizzle-orm';
import type { Env } from '../../config/env';
import { uuidv7 } from '../../lib/ids';
import { appendAudit } from '../../security/audit';
import { ensureStorageAccount } from '../account/account.service';

export interface AuthDeps {
	env: Env;
	db: Database;
}

export function createAuth({ env, db }: AuthDeps) {
	const socialProviders: Record<string, { clientId: string; clientSecret: string }> = {};
	if (env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET) {
		socialProviders.github = {
			clientId: env.GITHUB_CLIENT_ID,
			clientSecret: env.GITHUB_CLIENT_SECRET,
		};
	}
	if (env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET) {
		socialProviders.google = {
			clientId: env.GOOGLE_CLIENT_ID,
			clientSecret: env.GOOGLE_CLIENT_SECRET,
		};
	}

	return betterAuth({
		appName: 'SkillPouch',
		baseURL: env.API_PUBLIC_URL,
		basePath: '/v1/auth',
		secret: env.BETTER_AUTH_SECRET,
		trustedOrigins: [env.WEB_ORIGIN],
		database: drizzleAdapter(db, {
			provider: 'pg',
			schema: {
				user: users,
				session: sessions,
				account: accounts,
				verification: verifications,
			},
		}),
		emailAndPassword: { enabled: false },
		socialProviders,
		account: {
			accountLinking: {
				enabled: true,
				trustedProviders: ['github', 'google'],
				// A signed-in user may link a GitHub account whose email differs from their Google one.
				allowDifferentEmails: true,
			},
		},
		user: {
			additionalFields: {
				role: { type: 'string', required: false, defaultValue: 'user', input: false },
				suspendedAt: { type: 'date', required: false, input: false },
			},
		},
		session: {
			expiresIn: 7 * 24 * 3600,
			updateAge: 24 * 3600,
			additionalFields: {
				jkt: { type: 'string', required: false, input: false },
				stepUpAt: { type: 'date', required: false, input: false },
			},
		},
		advanced: {
			cookiePrefix: 'sp',
			useSecureCookies: env.NODE_ENV === 'production',
			database: { generateId: () => uuidv7() },
		},
		databaseHooks: {
			user: {
				create: {
					after: async (user) => {
						await ensureStorageAccount(db, user.id);
					},
				},
			},
			session: {
				create: {
					before: async (session) => ({ data: { ...session, stepUpAt: new Date() } }),
					after: async (session) => {
						await bootstrapAdmin(env, db, session.userId);
					},
				},
			},
		},
		// Test helpers (create users/sessions without OAuth) exist only in NODE_ENV=test.
		plugins: (env.NODE_ENV === 'test' ? [testUtils()] : []) as unknown as BetterAuthPlugin[],
	});
}

export type Auth = ReturnType<typeof createAuth>;

async function bootstrapAdmin(env: Env, db: Database, userId: string): Promise<void> {
	if (env.adminEmails.length === 0) return;
	const [user] = await db
		.select({ email: users.email, verified: users.emailVerified, role: users.role })
		.from(users)
		.where(eq(users.id, userId));
	if (!user || user.role === 'admin' || !user.verified) return;
	if (!env.adminEmails.includes(user.email.toLowerCase())) return;
	const storageAccountId = await ensureStorageAccount(db, userId);
	await db.transaction(async (tx) => {
		await tx.update(users).set({ role: 'admin' }).where(eq(users.id, userId));
		await tx.execute(sql`SELECT set_config('app.sa_id', ${storageAccountId}, true)`);
		await appendAudit(tx, {
			storageAccountId,
			actor: `user:${userId}`,
			action: 'role.granted_by_bootstrap',
			target: `user:${userId}`,
		});
	});
}
