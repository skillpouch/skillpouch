// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `/v1/admin/*`. `config.auth = 'admin'`: bound web session +
 * `role = admin`; every mutating method additionally needs a fresh sign-in
 * (step-up, enforced by the authentication hook) and a `reason`.
 */
import {
	AdminGrantPlan,
	AdminOverview,
	AdminPlan,
	AdminPlanInput,
	AdminReason,
	AdminSetOverride,
	AdminSetRole,
	AdminUser,
	AdminUserQuery,
	AuditEntry,
	Empty,
	IdParam,
	PageQuery,
	Timestamp,
	Uuid,
	WritePause,
} from '@skillpouch/contracts';
import { z } from 'zod';
import type { Deps } from '../../deps';
import { sessionOf } from '../../http/principal';
import type { ZodApp } from '../../http/zod-app';
import * as admin from './admin.service';

const UserParam = z.object({ id: z.string().min(1).max(64) });

const UserDetail = z.object({
	user: AdminUser,
	devices: z.array(
		z.object({
			id: Uuid,
			name: z.string(),
			os: z.string(),
			cli_version: z.string(),
			state: z.string(),
			last_seen_at: Timestamp.nullable(),
		}),
	),
	pouches: z.array(
		z.object({
			id: Uuid,
			state: z.string(),
			stored_bytes: z.number().int(),
			created_at: Timestamp,
		}),
	),
	security_events: z.array(
		z.object({ kind: z.string(), severity: z.string(), created_at: Timestamp }),
	),
	subscriptions: z.array(
		z.object({
			id: Uuid,
			status: z.string(),
			external_subscription_id: z.string(),
			current_period_end: Timestamp.nullable(),
		}),
	),
	grants: z.array(
		z.object({
			id: Uuid,
			plan_slug: z.string(),
			ends_at: Timestamp.nullable(),
			revoked_at: Timestamp.nullable(),
			reason: z.string(),
		}),
	),
	override: z
		.object({
			pouch_limit: z.number().int().nullable(),
			storage_bytes: z.number().int().nullable(),
			expires_at: Timestamp.nullable(),
			note: z.string(),
		})
		.nullable(),
});

export async function adminRoutes(app: ZodApp, deps: Deps) {
	const tags = ['admin'];

	app.get(
		'/v1/admin/overview',
		{
			config: { auth: 'admin' },
			schema: { tags, summary: 'Headline numbers', response: { 200: AdminOverview } },
		},
		async () => admin.overview(deps),
	);

	app.get(
		'/v1/admin/users',
		{
			config: { auth: 'admin' },
			schema: {
				tags,
				summary: 'Search users (email, name, id)',
				querystring: AdminUserQuery,
				response: { 200: z.object({ items: z.array(AdminUser) }) },
			},
		},
		async (request) => admin.listUsers(deps, request.query),
	);

	app.get(
		'/v1/admin/users/:id',
		{
			config: { auth: 'admin' },
			schema: {
				tags,
				summary: 'User detail: plan, usage, devices, pouches (ids + sizes only), events',
				params: UserParam,
				response: { 200: UserDetail },
			},
		},
		async (request) => admin.userDetail(deps, request.params.id),
	);

	app.post(
		'/v1/admin/users/:id/role',
		{
			config: { auth: 'admin' },
			schema: { tags, params: UserParam, body: AdminSetRole, response: { 200: Empty } },
		},
		async (request) => {
			await admin.setRole(
				deps,
				sessionOf(request),
				request.params.id,
				request.body.role,
				request.body.reason,
			);
			return {};
		},
	);

	app.post(
		'/v1/admin/users/:id/suspend',
		{
			config: { auth: 'admin' },
			schema: {
				tags,
				summary: 'Block API access (data is kept)',
				params: UserParam,
				body: AdminReason,
				response: { 200: Empty },
			},
		},
		async (request) => {
			await admin.setSuspended(
				deps,
				sessionOf(request),
				request.params.id,
				true,
				request.body.reason,
			);
			return {};
		},
	);

	app.post(
		'/v1/admin/users/:id/unsuspend',
		{
			config: { auth: 'admin' },
			schema: { tags, params: UserParam, body: AdminReason, response: { 200: Empty } },
		},
		async (request) => {
			await admin.setSuspended(
				deps,
				sessionOf(request),
				request.params.id,
				false,
				request.body.reason,
			);
			return {};
		},
	);

	app.post(
		'/v1/admin/users/:id/revoke-devices',
		{
			config: { auth: 'admin' },
			schema: {
				tags,
				params: UserParam,
				body: AdminReason,
				response: { 200: z.object({ revoked: z.number().int() }) },
			},
		},
		async (request) =>
			admin.revokeAllDevices(
				deps,
				sessionOf(request),
				request.params.id,
				request.body.reason,
			),
	);

	app.post(
		'/v1/admin/users/:id/grants',
		{
			config: { auth: 'admin' },
			schema: {
				tags,
				summary: 'Give a plan without payment (until a date or forever)',
				params: UserParam,
				body: AdminGrantPlan,
				response: { 200: z.object({ id: Uuid }) },
			},
		},
		async (request) =>
			admin.grantPlan(deps, sessionOf(request), request.params.id, request.body),
	);

	app.post(
		'/v1/admin/grants/:id/revoke',
		{
			config: { auth: 'admin' },
			schema: { tags, params: IdParam, body: AdminReason, response: { 200: Empty } },
		},
		async (request) => {
			await admin.revokeGrant(
				deps,
				sessionOf(request),
				request.params.id,
				request.body.reason,
			);
			return {};
		},
	);

	app.put(
		'/v1/admin/users/:id/override',
		{
			config: { auth: 'admin' },
			schema: {
				tags,
				summary: 'Per-user pouch/storage overrides (e.g. friends, beta testers)',
				params: UserParam,
				body: AdminSetOverride,
				response: { 200: Empty },
			},
		},
		async (request) => {
			await admin.setOverride(deps, sessionOf(request), request.params.id, request.body);
			return {};
		},
	);

	app.delete(
		'/v1/admin/users/:id/override',
		{
			config: { auth: 'admin' },
			schema: { tags, params: UserParam, body: AdminReason, response: { 200: Empty } },
		},
		async (request) => {
			await admin.clearOverride(
				deps,
				sessionOf(request),
				request.params.id,
				request.body.reason,
			);
			return {};
		},
	);

	app.post(
		'/v1/admin/users/:id/delete',
		{
			config: { auth: 'admin' },
			schema: {
				tags,
				summary: 'Schedule account deletion (7-day delay)',
				params: UserParam,
				body: AdminReason,
				response: { 200: z.object({ delete_after: Timestamp }) },
			},
		},
		async (request) =>
			admin.scheduleAccountDeletion(
				deps,
				sessionOf(request),
				request.params.id,
				request.body.reason,
			),
	);

	app.get(
		'/v1/admin/plans',
		{
			config: { auth: 'admin' },
			schema: { tags, response: { 200: z.object({ plans: z.array(AdminPlan) }) } },
		},
		async () => admin.listPlans(deps),
	);

	app.post(
		'/v1/admin/plans',
		{
			config: { auth: 'admin' },
			schema: {
				tags,
				summary: 'Create a plan (paid plans get a provider product)',
				body: AdminPlanInput,
				response: { 200: AdminPlan },
			},
		},
		async (request) => admin.createPlan(deps, sessionOf(request), request.body),
	);

	app.put(
		'/v1/admin/plans/:id',
		{
			config: { auth: 'admin' },
			schema: {
				tags,
				summary: 'Edit a plan; limit changes apply to all its users',
				params: IdParam,
				body: AdminPlanInput,
				response: { 200: AdminPlan },
			},
		},
		async (request) =>
			admin.updatePlan(deps, sessionOf(request), request.params.id, request.body),
	);

	app.get(
		'/v1/admin/subscriptions',
		{
			config: { auth: 'admin' },
			schema: {
				tags,
				response: {
					200: z.object({
						subscriptions: z.array(
							z.object({
								id: Uuid,
								email: z.string(),
								plan_slug: z.string().nullable(),
								status: z.string(),
								provider: z.string(),
								external_subscription_id: z.string(),
								amount_cents: z.number().int(),
								interval: z.string().nullable(),
								current_period_end: Timestamp.nullable(),
							}),
						),
					}),
				},
			},
		},
		async () => admin.listSubscriptions(deps),
	);

	app.get(
		'/v1/admin/audit',
		{
			config: { auth: 'admin' },
			schema: {
				tags,
				querystring: PageQuery,
				response: { 200: z.object({ items: z.array(AuditEntry) }) },
			},
		},
		async (request) => admin.listAudit(deps, request.query),
	);

	app.get(
		'/v1/admin/system',
		{
			config: { auth: 'admin' },
			schema: {
				tags,
				response: {
					200: z.object({
						version: z.string(),
						write_pause: z.boolean(),
						failed_jobs_24h: z.number().int(),
					}),
				},
			},
		},
		async () => admin.systemStatus(deps),
	);

	app.put(
		'/v1/admin/system/write-pause',
		{
			config: { auth: 'admin' },
			schema: {
				tags,
				summary: 'Hold all writes (DB switchover)',
				body: WritePause,
				response: { 200: z.object({ write_pause: z.boolean() }) },
			},
		},
		async (request) =>
			admin.setWritePause(
				deps,
				sessionOf(request),
				request.body.enabled,
				request.body.reason,
			),
	);
}
