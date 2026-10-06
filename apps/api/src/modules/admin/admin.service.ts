// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Admin dashboard back end (plan 18 §2–3).
 *
 * Reads and metadata writes go through the `sp_admin` pool, which has grants
 * on metadata tables only — never on ciphertext tables. E2EE still holds for
 * admins: they see counts and sizes, never names or content, and cannot add
 * keys or members to anyone's roster. Every mutation carries a `reason` and
 * lands in the hash-chained audit log.
 */
import { Limits } from '@skillpouch/contracts';
import {
	auditLog,
	devices,
	entitlementOverrides,
	planGrants,
	plans,
	pouches,
	securityEvents,
	sessions,
	storageAccounts,
	subscriptions,
	systemSettings,
	users,
} from '@skillpouch/db';
import {
	and,
	count,
	desc,
	eq,
	gt,
	ilike,
	inArray,
	isNull,
	lt,
	ne,
	or,
	sql,
	sum,
} from 'drizzle-orm';
import type { Deps } from '../../deps';
import { AppError } from '../../http/app-error';
import { decodeCursor, encodeCursor } from '../../http/cursor';
import { paginated } from '../../http/serialization';
import { WRITE_PAUSE_KEY } from '../../infra/settings';
import { addSeconds } from '../../lib/dates';
import { appendAudit } from '../../security/audit';
import { principalLabel, type SessionPrincipal } from '../../security/principal';
import { withTenantTx } from '../../security/tenant-tx';
import { revokeDeviceRow } from '../devices/devices.service';
import { refreshEntitlementsInTx } from '../entitlements/entitlements.service';

type PlanRow = typeof plans.$inferSelect;

export function planView(plan: PlanRow) {
	return {
		id: plan.id,
		slug: plan.slug,
		name: plan.name,
		description: plan.description,
		price_cents: plan.priceCents,
		currency: plan.currency,
		interval: plan.interval,
		pouch_limit: plan.pouchLimit,
		storage_bytes: plan.storageBytes,
		polar_product_id: plan.polarProductId,
		is_default: plan.isDefault,
		is_public: plan.isPublic,
		is_active: plan.isActive,
		sort: plan.sort,
	};
}

async function audit(
	deps: Deps,
	admin: SessionPrincipal,
	action: string,
	entry: {
		storageAccountId?: string | null | undefined;
		target?: string;
		details?: Record<string, unknown>;
	},
) {
	await deps.db.admin.transaction((tx) =>
		appendAudit(tx, {
			storageAccountId: entry.storageAccountId ?? null,
			actor: principalLabel(admin),
			action,
			target: entry.target ?? null,
			details: entry.details ?? {},
		}),
	);
}

/** Recomputes cached entitlements after a grant/override/plan change. */
export async function refreshAccount(deps: Deps, storageAccountId: string) {
	await withTenantTx(deps.db.app, storageAccountId, (tx) =>
		refreshEntitlementsInTx(tx, storageAccountId, deps.now()),
	);
}

export async function overview(deps: Deps) {
	const db = deps.db.admin;
	const now = deps.now();
	const [[userCount], [signups], [activeDevices], [pouchCount], [storage], [subs]] =
		await Promise.all([
			db.select({ n: count() }).from(users),
			db
				.select({ n: count() })
				.from(users)
				.where(gt(users.createdAt, addSeconds(now, -7 * 86400))),
			db
				.select({ n: count() })
				.from(devices)
				.where(
					and(
						eq(devices.state, 'active'),
						gt(devices.lastSeenAt, addSeconds(now, -30 * 86400)),
					),
				),
			db.select({ n: count() }).from(pouches).where(ne(pouches.state, 'deleted')),
			db.select({ n: sum(storageAccounts.usedBytes) }).from(storageAccounts),
			db
				.select({
					n: count(),
					mrr: sql<string>`COALESCE(sum(CASE WHEN ${subscriptions.interval} = 'year' THEN ${subscriptions.amountCents} / 12 ELSE ${subscriptions.amountCents} END), 0)`,
				})
				.from(subscriptions)
				.where(inArray(subscriptions.status, ['active', 'trialing'])),
		]);
	return {
		users: userCount?.n ?? 0,
		signups_7d: signups?.n ?? 0,
		active_devices_30d: activeDevices?.n ?? 0,
		pouches: pouchCount?.n ?? 0,
		storage_used_bytes: Number(storage?.n ?? 0),
		active_subscriptions: subs?.n ?? 0,
		mrr_cents: Math.round(Number(subs?.mrr ?? 0)),
	};
}

async function userRows(deps: Deps, where: ReturnType<typeof and> | undefined, limit: number) {
	const db = deps.db.admin;
	const rows = await db
		.select({ user: users, account: storageAccounts })
		.from(users)
		.leftJoin(storageAccounts, eq(storageAccounts.ownerUserId, users.id))
		.where(where)
		.orderBy(desc(users.createdAt), desc(users.id))
		.limit(limit);
	const accountIds = rows.flatMap((row) => (row.account ? [row.account.id] : []));
	const deviceCounts = accountIds.length
		? await db
				.select({ id: devices.storageAccountId, n: count() })
				.from(devices)
				.where(
					and(inArray(devices.storageAccountId, accountIds), eq(devices.state, 'active')),
				)
				.groupBy(devices.storageAccountId)
		: [];
	const pouchCounts = accountIds.length
		? await db
				.select({ id: pouches.storageAccountId, n: count() })
				.from(pouches)
				.where(
					and(
						inArray(pouches.storageAccountId, accountIds),
						ne(pouches.state, 'deleted'),
					),
				)
				.groupBy(pouches.storageAccountId)
		: [];
	const deviceBy = new Map(deviceCounts.map((row) => [row.id, row.n]));
	const pouchBy = new Map(pouchCounts.map((row) => [row.id, row.n]));
	return rows.map(({ user, account }) => ({
		id: user.id,
		email: user.email,
		name: user.name,
		role: user.role,
		suspended_at: user.suspendedAt?.toISOString() ?? null,
		created_at: user.createdAt.toISOString(),
		storage_account_id: account?.id ?? null,
		entitlements: account?.entitlements ?? null,
		used_bytes: account?.usedBytes ?? 0,
		device_count: account ? (deviceBy.get(account.id) ?? 0) : 0,
		pouch_count: account ? (pouchBy.get(account.id) ?? 0) : 0,
	}));
}

/** Users, newest first; `q` matches email/name/id. Cursor = `createdAt|id` of the last row. */
export async function listUsers(
	deps: Deps,
	query: { q?: string | undefined; cursor?: string | undefined; limit: number },
) {
	const conditions = [];
	if (query.q) {
		const pattern = `%${query.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
		conditions.push(
			or(ilike(users.email, pattern), ilike(users.name, pattern), eq(users.id, query.q)),
		);
	}
	const cursor = decodeCursor(query.cursor);
	if (cursor) {
		const [created, id] = cursor.split('|');
		const at = new Date(created ?? '');
		if (Number.isNaN(at.getTime()) || !id)
			throw new AppError('validation_failed', { reason: 'cursor' });
		conditions.push(
			or(lt(users.createdAt, at), and(eq(users.createdAt, at), lt(users.id, id))),
		);
	}
	const rows = await userRows(
		deps,
		conditions.length ? and(...conditions) : undefined,
		query.limit + 1,
	);
	const page = rows.slice(0, query.limit);
	const last = page.at(-1);
	return paginated(
		page,
		rows.length > query.limit && last ? encodeCursor(`${last.created_at}|${last.id}`) : null,
	);
}

export async function findUser(deps: Deps, userId: string) {
	const [row] = await deps.db.admin
		.select({ user: users, account: storageAccounts })
		.from(users)
		.leftJoin(storageAccounts, eq(storageAccounts.ownerUserId, users.id))
		.where(eq(users.id, userId));
	if (!row) throw new AppError('not_found');
	return row;
}

export async function userDetail(deps: Deps, userId: string) {
	const db = deps.db.admin;
	const { account } = await findUser(deps, userId);
	const [summary] = await userRows(deps, eq(users.id, userId), 1);
	if (!account)
		return {
			user: summary!,
			devices: [],
			pouches: [],
			security_events: [],
			subscriptions: [],
			grants: [],
			override: null,
		};
	const [deviceRows, pouchRows, eventRows, subRows, grantRows, [override]] = await Promise.all([
		db
			.select()
			.from(devices)
			.where(eq(devices.storageAccountId, account.id))
			.orderBy(desc(devices.createdAt)),
		db
			.select({
				id: pouches.id,
				state: pouches.state,
				created_at: pouches.createdAt,
				stored_bytes: sql<string>`(SELECT COALESCE(sum(stored_size), 0) FROM blobs b WHERE b.pouch_id = ${pouches.id})`,
			})
			.from(pouches)
			.where(eq(pouches.storageAccountId, account.id)),
		db
			.select()
			.from(securityEvents)
			.where(eq(securityEvents.storageAccountId, account.id))
			.orderBy(desc(securityEvents.createdAt))
			.limit(50),
		db.select().from(subscriptions).where(eq(subscriptions.storageAccountId, account.id)),
		db
			.select({ grant: planGrants, slug: plans.slug })
			.from(planGrants)
			.innerJoin(plans, eq(plans.id, planGrants.planId))
			.where(eq(planGrants.storageAccountId, account.id)),
		db
			.select()
			.from(entitlementOverrides)
			.where(eq(entitlementOverrides.storageAccountId, account.id)),
	]);
	return {
		user: summary!,
		devices: deviceRows.map((device) => ({
			id: device.id,
			name: device.name,
			os: device.os,
			cli_version: device.cliVersion,
			state: device.state,
			last_seen_at: device.lastSeenAt?.toISOString() ?? null,
		})),
		pouches: pouchRows.map((pouch) => ({
			id: pouch.id,
			state: pouch.state,
			stored_bytes: Number(pouch.stored_bytes),
			created_at: pouch.created_at.toISOString(),
		})),
		security_events: eventRows.map((event) => ({
			kind: event.kind,
			severity: event.severity,
			created_at: event.createdAt.toISOString(),
		})),
		subscriptions: subRows.map((sub) => ({
			id: sub.id,
			status: sub.status,
			external_subscription_id: sub.externalSubscriptionId,
			current_period_end: sub.currentPeriodEnd?.toISOString() ?? null,
		})),
		grants: grantRows.map(({ grant, slug }) => ({
			id: grant.id,
			plan_slug: slug,
			ends_at: grant.endsAt?.toISOString() ?? null,
			revoked_at: grant.revokedAt?.toISOString() ?? null,
			reason: grant.reason,
		})),
		override: override
			? {
					pouch_limit: override.pouchLimit,
					storage_bytes: override.storageBytes,
					expires_at: override.expiresAt?.toISOString() ?? null,
					note: override.note,
				}
			: null,
	};
}

function requireAccount(row: Awaited<ReturnType<typeof findUser>>) {
	if (!row.account) throw new AppError('not_found', { reason: 'user has no storage account' });
	return row.account;
}

export async function setRole(
	deps: Deps,
	admin: SessionPrincipal,
	userId: string,
	role: 'user' | 'admin',
	reason: string,
) {
	const row = await findUser(deps, userId);
	await deps.db.admin.transaction(async (tx) => {
		if (row.user.role === 'admin' && role === 'user') {
			// Serialize demotions so two admins cannot demote each other at once.
			await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('admin:roles'))`);
			const [admins] = await tx
				.select({ n: count() })
				.from(users)
				.where(eq(users.role, 'admin'));
			if ((admins?.n ?? 0) <= 1) throw new AppError('last_admin');
		}
		await tx.update(users).set({ role, updatedAt: deps.now() }).where(eq(users.id, userId));
	});
	await audit(deps, admin, 'admin.role_changed', {
		storageAccountId: row.account?.id,
		target: userId,
		details: { role, reason },
	});
}

export async function setSuspended(
	deps: Deps,
	admin: SessionPrincipal,
	userId: string,
	suspended: boolean,
	reason: string,
) {
	const row = await findUser(deps, userId);
	if (suspended && userId === admin.userId)
		throw new AppError('forbidden', { reason: 'cannot suspend yourself' });
	await deps.db.admin.transaction(async (tx) => {
		await tx
			.update(users)
			.set({ suspendedAt: suspended ? deps.now() : null, updatedAt: deps.now() })
			.where(eq(users.id, userId));
		// Suspension blocks the web immediately: drop every session.
		if (suspended) await tx.delete(sessions).where(eq(sessions.userId, userId));
	});
	// Other instances notice within their ≤ 1 s device-status cache window.
	deps.deviceStatus.invalidateAll();
	await audit(deps, admin, suspended ? 'admin.user_suspended' : 'admin.user_unsuspended', {
		storageAccountId: row.account?.id,
		target: userId,
		details: { reason },
	});
}

export async function revokeAllDevices(
	deps: Deps,
	admin: SessionPrincipal,
	userId: string,
	reason: string,
) {
	const account = requireAccount(await findUser(deps, userId));
	const revoked = await withTenantTx(deps.db.app, account.id, async (tx) => {
		const rows = await tx
			.select()
			.from(devices)
			.where(ne(devices.state, 'revoked'))
			.for('update');
		for (const device of rows)
			await revokeDeviceRow(tx, device, 'revoked_by_admin', deps.now());
		return rows.length;
	});
	await audit(deps, admin, 'admin.devices_revoked', {
		storageAccountId: account.id,
		target: userId,
		details: { reason, count: revoked },
	});
	return { revoked };
}

export async function grantPlan(
	deps: Deps,
	admin: SessionPrincipal,
	userId: string,
	input: { plan_slug: string; ends_at: string | null; reason: string },
) {
	const account = requireAccount(await findUser(deps, userId));
	const [plan] = await deps.db.admin.select().from(plans).where(eq(plans.slug, input.plan_slug));
	if (!plan) throw new AppError('not_found', { reason: 'plan' });
	const [grant] = await deps.db.admin
		.insert(planGrants)
		.values({
			storageAccountId: account.id,
			planId: plan.id,
			endsAt: input.ends_at ? new Date(input.ends_at) : null,
			reason: input.reason,
			grantedBy: admin.userId,
		})
		.returning();
	await refreshAccount(deps, account.id);
	await audit(deps, admin, 'admin.plan_granted', {
		storageAccountId: account.id,
		target: userId,
		details: { plan: plan.slug, ends_at: input.ends_at, reason: input.reason },
	});
	return { id: grant!.id };
}

export async function revokeGrant(
	deps: Deps,
	admin: SessionPrincipal,
	grantId: string,
	reason: string,
) {
	const [grant] = await deps.db.admin
		.update(planGrants)
		.set({ revokedAt: deps.now() })
		.where(and(eq(planGrants.id, grantId), isNull(planGrants.revokedAt)))
		.returning();
	if (!grant) throw new AppError('not_found');
	await refreshAccount(deps, grant.storageAccountId);
	await audit(deps, admin, 'admin.grant_revoked', {
		storageAccountId: grant.storageAccountId,
		target: grantId,
		details: { reason },
	});
}

export async function setOverride(
	deps: Deps,
	admin: SessionPrincipal,
	userId: string,
	input: {
		pouch_limit: number | null;
		storage_bytes: number | null;
		expires_at: string | null;
		note: string;
		reason: string;
	},
) {
	const account = requireAccount(await findUser(deps, userId));
	const values = {
		pouchLimit: input.pouch_limit,
		storageBytes: input.storage_bytes,
		expiresAt: input.expires_at ? new Date(input.expires_at) : null,
		note: input.note,
		updatedBy: admin.userId,
		updatedAt: deps.now(),
	};
	await deps.db.admin
		.insert(entitlementOverrides)
		.values({ storageAccountId: account.id, ...values })
		.onConflictDoUpdate({ target: entitlementOverrides.storageAccountId, set: values });
	await refreshAccount(deps, account.id);
	await audit(deps, admin, 'admin.override_set', {
		storageAccountId: account.id,
		target: userId,
		details: {
			pouch_limit: input.pouch_limit,
			storage_bytes: input.storage_bytes,
			note: input.note,
			reason: input.reason,
		},
	});
}

export async function clearOverride(
	deps: Deps,
	admin: SessionPrincipal,
	userId: string,
	reason: string,
) {
	const account = requireAccount(await findUser(deps, userId));
	await deps.db.admin
		.delete(entitlementOverrides)
		.where(eq(entitlementOverrides.storageAccountId, account.id));
	await refreshAccount(deps, account.id);
	await audit(deps, admin, 'admin.override_cleared', {
		storageAccountId: account.id,
		target: userId,
		details: { reason },
	});
}

export async function scheduleAccountDeletion(
	deps: Deps,
	admin: SessionPrincipal,
	userId: string,
	reason: string,
) {
	const account = requireAccount(await findUser(deps, userId));
	const deleteAfter = addSeconds(deps.now(), Limits.undoWindowDays * 86400);
	await deps.db.admin
		.update(storageAccounts)
		.set({ deleteAfter, updatedAt: deps.now() })
		.where(eq(storageAccounts.id, account.id));
	await audit(deps, admin, 'admin.account_delete_scheduled', {
		storageAccountId: account.id,
		target: userId,
		details: { reason },
	});
	return { delete_after: deleteAfter.toISOString() };
}

// ---- plans ------------------------------------------------------------------

export async function listPlans(deps: Deps) {
	const rows = await deps.db.admin.select().from(plans).orderBy(plans.sort, plans.createdAt);
	return { plans: rows.map(planView) };
}

interface PlanInput {
	slug?: string | undefined;
	name: string;
	description: string;
	price_cents: number;
	currency: string;
	interval: 'month' | 'year' | null;
	pouch_limit: number;
	storage_bytes: number;
	is_public: boolean;
	is_active: boolean;
	sort: number;
	reason: string;
}

async function syncProduct(
	deps: Deps,
	input: PlanInput,
	productId: string | null,
): Promise<string | null> {
	if (input.price_cents === 0 || !input.interval) return productId;
	if (!deps.billing) return productId;
	return deps.billing.syncProduct({
		productId,
		name: input.name,
		description: input.description,
		priceCents: input.price_cents,
		currency: input.currency,
		interval: input.interval,
	});
}

/** Paid plans need an interval; their provider product is created / updated alongside. */
function validatePlan(input: PlanInput) {
	if (input.price_cents > 0 && !input.interval) {
		throw new AppError('validation_failed', { reason: 'paid plans need an interval' });
	}
}

export async function createPlan(deps: Deps, admin: SessionPrincipal, input: PlanInput) {
	validatePlan(input);
	if (!input.slug) throw new AppError('validation_failed', { reason: 'slug is required' });
	const [existing] = await deps.db.admin
		.select({ id: plans.id })
		.from(plans)
		.where(eq(plans.slug, input.slug));
	if (existing) throw new AppError('validation_failed', { reason: 'slug already exists' });
	const polarProductId = await syncProduct(deps, input, null);
	const [plan] = await deps.db.admin
		.insert(plans)
		.values({
			slug: input.slug,
			name: input.name,
			description: input.description,
			priceCents: input.price_cents,
			currency: input.currency,
			interval: input.interval,
			pouchLimit: input.pouch_limit,
			storageBytes: input.storage_bytes,
			polarProductId,
			isPublic: input.is_public,
			isActive: input.is_active,
			sort: input.sort,
		})
		.returning();
	await audit(deps, admin, 'admin.plan_created', {
		target: plan!.slug,
		details: { reason: input.reason },
	});
	return planView(plan!);
}

export async function updatePlan(
	deps: Deps,
	admin: SessionPrincipal,
	planId: string,
	input: PlanInput,
) {
	validatePlan(input);
	const [current] = await deps.db.admin.select().from(plans).where(eq(plans.id, planId));
	if (!current) throw new AppError('not_found');
	if (current.isDefault && (!input.is_active || input.price_cents > 0)) {
		throw new AppError('validation_failed', {
			reason: 'the default plan stays free and active',
		});
	}
	const priceChanged =
		current.priceCents !== input.price_cents ||
		current.interval !== input.interval ||
		current.name !== input.name;
	const polarProductId = priceChanged
		? await syncProduct(deps, input, current.polarProductId)
		: current.polarProductId;
	const [plan] = await deps.db.admin
		.update(plans)
		.set({
			name: input.name,
			description: input.description,
			priceCents: input.price_cents,
			currency: input.currency,
			interval: input.interval,
			pouchLimit: input.pouch_limit,
			storageBytes: input.storage_bytes,
			polarProductId,
			isPublic: input.is_public,
			isActive: input.is_active,
			sort: input.sort,
			updatedAt: deps.now(),
		})
		.where(eq(plans.id, planId))
		.returning();
	// New limits apply to everyone on the plan.
	if (current.pouchLimit !== input.pouch_limit || current.storageBytes !== input.storage_bytes) {
		const accounts = await deps.db.admin
			.select({ id: storageAccounts.id })
			.from(storageAccounts);
		for (const account of accounts) await refreshAccount(deps, account.id);
	}
	await audit(deps, admin, 'admin.plan_updated', {
		target: plan!.slug,
		details: { reason: input.reason },
	});
	return planView(plan!);
}

// ---- subscriptions, audit, system ------------------------------------------------

export async function listSubscriptions(deps: Deps) {
	const rows = await deps.db.admin
		.select({ sub: subscriptions, email: users.email, slug: plans.slug })
		.from(subscriptions)
		.innerJoin(storageAccounts, eq(storageAccounts.id, subscriptions.storageAccountId))
		.innerJoin(users, eq(users.id, storageAccounts.ownerUserId))
		.leftJoin(plans, eq(plans.id, subscriptions.planId))
		.orderBy(desc(subscriptions.updatedAt))
		.limit(500);
	return {
		subscriptions: rows.map(({ sub, email, slug }) => ({
			id: sub.id,
			email,
			plan_slug: slug,
			status: sub.status,
			provider: sub.provider,
			external_subscription_id: sub.externalSubscriptionId,
			amount_cents: sub.amountCents,
			interval: sub.interval,
			current_period_end: sub.currentPeriodEnd?.toISOString() ?? null,
		})),
	};
}

export async function listAudit(deps: Deps, query: { cursor?: string | undefined; limit: number }) {
	const before = decodeCursor(query.cursor);
	const rows = await deps.db.admin
		.select()
		.from(auditLog)
		.where(before ? lt(auditLog.createdAt, new Date(before)) : undefined)
		.orderBy(desc(auditLog.createdAt))
		.limit(query.limit + 1);
	const page = rows.slice(0, query.limit);
	return paginated(
		page.map((row) => ({
			id: row.id,
			storage_account_id: row.storageAccountId,
			actor: row.actor,
			action: row.action,
			target: row.target,
			details: row.details,
			created_at: row.createdAt.toISOString(),
		})),
		rows.length > query.limit ? encodeCursor(page.at(-1)!.createdAt.toISOString()) : null,
	);
}

export async function systemStatus(deps: Deps) {
	const [pause] = await deps.db.admin
		.select()
		.from(systemSettings)
		.where(eq(systemSettings.key, WRITE_PAUSE_KEY));
	const jobs = await deps.db.admin.execute(sql`
		SELECT to_regclass('pgboss.job') IS NOT NULL AS installed`);
	let failedJobs = 0;
	if ((jobs.rows[0] as { installed?: boolean } | undefined)?.installed) {
		const failed = await deps.db.maintenance.execute(
			sql`SELECT count(*)::int AS n FROM pgboss.job WHERE state = 'failed' AND created_on > now() - interval '1 day'`,
		);
		failedJobs = (failed.rows[0] as { n: number }).n;
	}
	return {
		version: process.env.SKILLPOUCH_VERSION ?? 'dev',
		write_pause:
			(pause?.value as { enabled?: boolean } | undefined)?.enabled === true ||
			deps.env.MAINTENANCE_WRITE_PAUSE,
		failed_jobs_24h: failedJobs,
	};
}

export async function setWritePause(
	deps: Deps,
	admin: SessionPrincipal,
	enabled: boolean,
	reason: string,
) {
	const value = { enabled, by: admin.userId, at: deps.now().toISOString() };
	await deps.db.admin
		.insert(systemSettings)
		.values({ key: WRITE_PAUSE_KEY, value })
		.onConflictDoUpdate({ target: systemSettings.key, set: { value, updatedAt: deps.now() } });
	deps.settings.invalidate();
	await audit(deps, admin, enabled ? 'admin.write_pause_on' : 'admin.write_pause_off', {
		details: { reason },
	});
	return { write_pause: enabled };
}
