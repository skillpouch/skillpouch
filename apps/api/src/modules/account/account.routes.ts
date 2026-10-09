// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Account-level routes: who am I, plans, security page data, account
 * deletion and the "lost everything" encrypted-data reset.
 */
import {
	ClientSecurityReport,
	CliLatest,
	Empty,
	IdParam,
	Limits,
	MeResponse,
	Plan,
	SecurityEvent,
	toBase64Url,
} from '@skillpouch/contracts';
import { devices, plans, securityEvents, storageAccounts, users } from '@skillpouch/db';
import { and, asc, desc, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';
import type { Deps } from '../../deps';
import { AppError } from '../../http/app-error';
import { principalOf, sessionOf } from '../../http/principal';
import type { ZodApp } from '../../http/zod-app';
import { addSeconds } from '../../lib/dates';
import { appendAudit } from '../../security/audit';
import { isStepUpFresh } from '../../security/authenticate';
import { principalLabel } from '../../security/principal';
import { withTenantTx } from '../../security/tenant-tx';

export async function accountRoutes(app: ZodApp, deps: Deps) {
	app.get(
		'/v1/me',
		{
			config: { auth: 'any', allowUnbound: true },
			schema: {
				tags: ['account'],
				summary: 'Current user, account, entitlements and usage',
				response: { 200: MeResponse },
			},
		},
		async (request) => {
			const principal = principalOf(request);
			const [user] = await deps.db.app
				.select()
				.from(users)
				.where(eq(users.id, principal.userId));
			if (!user) throw new AppError('unauthenticated');
			return withTenantTx(deps.db.app, principal.storageAccountId, async (tx) => {
				const [account] = await tx
					.select()
					.from(storageAccounts)
					.where(eq(storageAccounts.id, principal.storageAccountId));
				if (!account) throw new AppError('not_found');
				let device: { id: string; name: string } | null = null;
				if (principal.kind === 'device') {
					const [row] = await tx
						.select({ id: devices.id, name: devices.name })
						.from(devices)
						.where(eq(devices.id, principal.deviceId));
					device = row ?? null;
				}
				return {
					user: {
						id: user.id,
						email: user.email,
						name: user.name,
						image: user.image,
						role: user.role,
					},
					account: {
						id: account.id,
						entitlements: account.entitlements,
						quota_bytes: account.quotaBytes,
						used_bytes: account.usedBytes,
						roster_initialized: account.genesisHash !== null,
						genesis_hash: account.genesisHash ? toBase64Url(account.genesisHash) : null,
						roster_seq: account.genesisHash ? account.rosterSeq : -1,
						delete_after: account.deleteAfter?.toISOString() ?? null,
					},
					session:
						principal.kind === 'session'
							? {
									bound: principal.jkt !== null,
									jkt: principal.jkt,
									step_up_fresh: isStepUpFresh(principal, deps.now()),
								}
							: null,
					device,
				};
			});
		},
	);

	app.get(
		'/v1/plans',
		{
			config: { auth: 'public' },
			schema: {
				tags: ['billing'],
				summary: 'Public, active plans (pricing page)',
				response: { 200: z.object({ plans: z.array(Plan) }) },
			},
		},
		async () => {
			const rows = await deps.db.app
				.select()
				.from(plans)
				.where(and(eq(plans.isPublic, true), eq(plans.isActive, true)))
				.orderBy(asc(plans.sort));
			return {
				plans: rows.map((plan) => ({
					slug: plan.slug,
					name: plan.name,
					description: plan.description,
					price_cents: plan.priceCents,
					currency: plan.currency,
					interval: plan.interval,
					pouch_limit: plan.pouchLimit,
					storage_bytes: plan.storageBytes,
				})),
			};
		},
	);

	app.get(
		'/v1/cli/latest',
		{
			config: { auth: 'public' },
			schema: {
				tags: ['devices'],
				summary: 'Latest CLI version (from npm) and minimum supported version',
				response: { 200: CliLatest },
			},
		},
		async () => ({
			version: (await deps.cliReleases.latest()) ?? deps.env.CLI_MIN_VERSION,
			min_supported: deps.env.CLI_MIN_VERSION,
		}),
	);

	app.get(
		'/v1/security/events',
		{
			config: { auth: 'any' },
			schema: {
				tags: ['account'],
				summary: 'Security events for the Security page',
				response: { 200: z.object({ events: z.array(SecurityEvent) }) },
			},
		},
		async (request) => {
			const principal = principalOf(request);
			return withTenantTx(deps.db.app, principal.storageAccountId, async (tx) => {
				const rows = await tx
					.select()
					.from(securityEvents)
					.orderBy(desc(securityEvents.createdAt))
					.limit(200);
				return {
					events: rows.map((row) => ({
						id: row.id,
						kind: row.kind,
						severity: row.severity,
						details: row.details,
						created_at: row.createdAt.toISOString(),
						acknowledged_at: row.acknowledgedAt?.toISOString() ?? null,
					})),
				};
			});
		},
	);

	app.post(
		'/v1/security/events/:id/ack',
		{
			config: { auth: 'any' },
			schema: { tags: ['account'], params: IdParam, response: { 200: Empty } },
		},
		async (request) => {
			const principal = principalOf(request);
			await withTenantTx(deps.db.app, principal.storageAccountId, async (tx) => {
				const updated = await tx
					.update(securityEvents)
					.set({ acknowledgedAt: deps.now() })
					.where(
						and(
							eq(securityEvents.id, request.params.id),
							isNull(securityEvents.acknowledgedAt),
						),
					)
					.returning({ id: securityEvents.id });
				if (updated.length === 0) {
					const [exists] = await tx
						.select({ id: securityEvents.id })
						.from(securityEvents)
						.where(eq(securityEvents.id, request.params.id));
					if (!exists) throw new AppError('not_found');
				}
			});
			return {};
		},
	);

	app.post(
		'/v1/security/reports',
		{
			config: { auth: 'any' },
			schema: {
				tags: ['account'],
				summary:
					'Client-reported E2EE verification failure (should never happen; pages the operator)',
				body: ClientSecurityReport,
				response: { 200: Empty },
			},
		},
		async (request) => {
			const principal = principalOf(request);
			request.log.error(
				{ kind: request.body.kind, reporter: principalLabel(principal) },
				'client E2EE verification failure',
			);
			await withTenantTx(deps.db.app, principal.storageAccountId, async (tx) => {
				await tx.insert(securityEvents).values({
					storageAccountId: principal.storageAccountId,
					kind: `client.${request.body.kind}`,
					severity: 'critical',
					details: {
						...request.body.details,
						pouch_id: request.body.pouch_id ?? null,
						reporter: principalLabel(principal),
					},
				});
			});
			return {};
		},
	);

	const scheduleSchema = z.object({ delete_after: z.string().nullable() });

	app.delete(
		'/v1/account',
		{
			config: { auth: 'session', stepUp: true },
			schema: {
				tags: ['account'],
				summary: 'Delete the account after a 7-day grace period',
				response: { 200: scheduleSchema },
			},
		},
		async (request) => {
			const principal = sessionOf(request);
			const deleteAfter = addSeconds(deps.now(), Limits.undoWindowDays * 86400);
			await withTenantTx(deps.db.app, principal.storageAccountId, async (tx) => {
				await tx
					.update(storageAccounts)
					.set({ deleteAfter })
					.where(eq(storageAccounts.id, principal.storageAccountId));
				await appendAudit(tx, {
					storageAccountId: principal.storageAccountId,
					actor: principalLabel(principal),
					action: 'account.delete_scheduled',
				});
			});
			return { delete_after: deleteAfter.toISOString() };
		},
	);

	app.post(
		'/v1/account/restore',
		{
			config: { auth: 'session' },
			schema: {
				tags: ['account'],
				summary: 'Cancel a scheduled account deletion',
				response: { 200: scheduleSchema },
			},
		},
		async (request) => {
			const principal = sessionOf(request);
			await withTenantTx(deps.db.app, principal.storageAccountId, async (tx) => {
				await tx
					.update(storageAccounts)
					.set({ deleteAfter: null })
					.where(eq(storageAccounts.id, principal.storageAccountId));
				await appendAudit(tx, {
					storageAccountId: principal.storageAccountId,
					actor: principalLabel(principal),
					action: 'account.delete_canceled',
				});
			});
			return { delete_after: null };
		},
	);

	app.post(
		'/v1/account/reset-encryption',
		{
			config: { auth: 'session', stepUp: true },
			schema: {
				tags: ['account'],
				summary: 'Lost every unlock method: wipe all encrypted data after 7 days',
				body: z.strictObject({ confirm: z.literal('RESET MY ENCRYPTED DATA') }),
				response: { 200: z.object({ reset_after: z.string().nullable() }) },
			},
		},
		async (request) => {
			const principal = sessionOf(request);
			const resetAfter = addSeconds(deps.now(), Limits.undoWindowDays * 86400);
			await withTenantTx(deps.db.app, principal.storageAccountId, async (tx) => {
				await tx
					.update(storageAccounts)
					.set({ resetAfter })
					.where(eq(storageAccounts.id, principal.storageAccountId));
				await appendAudit(tx, {
					storageAccountId: principal.storageAccountId,
					actor: principalLabel(principal),
					action: 'account.reset_scheduled',
				});
			});
			return { reset_after: resetAfter.toISOString() };
		},
	);

	app.delete(
		'/v1/account/reset-encryption',
		{
			config: { auth: 'session' },
			schema: {
				tags: ['account'],
				summary: 'Cancel a scheduled encrypted-data reset',
				response: { 200: z.object({ reset_after: z.string().nullable() }) },
			},
		},
		async (request) => {
			const principal = sessionOf(request);
			await withTenantTx(deps.db.app, principal.storageAccountId, (tx) =>
				tx
					.update(storageAccounts)
					.set({ resetAfter: null })
					.where(eq(storageAccounts.id, principal.storageAccountId)),
			);
			return { reset_after: null };
		},
	);
}
