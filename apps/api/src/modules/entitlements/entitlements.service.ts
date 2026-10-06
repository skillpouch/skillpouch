// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Loads the inputs for `resolveEntitlements`, caches the result on the
 * storage account and applies the consequences (18 §3.3): pouches beyond the
 * limit become read-only (newest first) and come back when the limit allows.
 * Nothing is ever deleted.
 */
import { AppError } from '../../http/app-error';
import {
	entitlementOverrides,
	planGrants,
	plans,
	pouches,
	storageAccounts,
	subscriptions,
	type Database,
	type EntitlementsJson,
} from '@skillpouch/db';
import { and, asc, eq, inArray, ne } from 'drizzle-orm';
import { notifyAccount } from '../../infra/notify';
import { withTenantTx, type TenantTx } from '../../security/tenant-tx';
import { resolveEntitlements, type PlanLimits } from './resolve';

type PlanRow = typeof plans.$inferSelect;

const toLimits = (plan: PlanRow): PlanLimits => ({
	slug: plan.slug,
	name: plan.name,
	pouchLimit: plan.pouchLimit,
	storageBytes: plan.storageBytes,
});

/** Effective entitlements of the default plan, for new accounts. */
export async function defaultEntitlements(db: Pick<Database, 'select'>): Promise<EntitlementsJson> {
	const [plan] = await db.select().from(plans).where(eq(plans.isDefault, true));
	if (!plan) throw new AppError('internal_error', { reason: 'no default plan seeded' });
	return {
		plan_slug: plan.slug,
		plan_name: plan.name,
		source: 'default',
		pouch_limit: plan.pouchLimit,
		storage_bytes: plan.storageBytes,
	};
}

/** Recomputes and stores entitlements inside a tenant transaction. */
export async function refreshEntitlementsInTx(
	tx: TenantTx,
	storageAccountId: string,
	now = new Date(),
) {
	const allPlans = await tx.select().from(plans);
	const byId = new Map(allPlans.map((plan) => [plan.id, plan]));
	const defaultPlan = allPlans.find((plan) => plan.isDefault);
	if (!defaultPlan) throw new AppError('internal_error', { reason: 'no default plan seeded' });

	const subs = await tx
		.select()
		.from(subscriptions)
		.where(eq(subscriptions.storageAccountId, storageAccountId));
	const grants = await tx
		.select()
		.from(planGrants)
		.where(eq(planGrants.storageAccountId, storageAccountId));
	const [override] = await tx
		.select()
		.from(entitlementOverrides)
		.where(eq(entitlementOverrides.storageAccountId, storageAccountId));

	const effective = resolveEntitlements({
		defaultPlan: toLimits(defaultPlan),
		subscriptions: subs.map((sub) => {
			const plan = sub.planId ? byId.get(sub.planId) : undefined;
			return {
				plan: plan ? toLimits(plan) : null,
				status: sub.status,
				currentPeriodEnd: sub.currentPeriodEnd,
				updatedAt: sub.updatedAt,
			};
		}),
		grants: grants.flatMap((grant) => {
			const plan = byId.get(grant.planId);
			return plan
				? [
						{
							plan: toLimits(plan),
							startsAt: grant.startsAt,
							endsAt: grant.endsAt,
							revokedAt: grant.revokedAt,
						},
					]
				: [];
		}),
		override: override ?? null,
		now,
	});

	const [account] = await tx
		.select({
			entitlements: storageAccounts.entitlements,
			usedBytes: storageAccounts.usedBytes,
		})
		.from(storageAccounts)
		.where(eq(storageAccounts.id, storageAccountId));
	const overQuota = (account?.usedBytes ?? 0) > effective.storage_bytes;
	await tx
		.update(storageAccounts)
		.set({ entitlements: effective, quotaBytes: effective.storage_bytes, updatedAt: now })
		.where(eq(storageAccounts.id, storageAccountId));
	await tx
		.update(storageAccounts)
		.set({ overQuotaSince: overQuota ? now : null })
		.where(and(eq(storageAccounts.id, storageAccountId)));

	await applyPouchLimit(tx, storageAccountId, effective.pouch_limit);
	if (JSON.stringify(account?.entitlements) !== JSON.stringify(effective)) {
		await notifyAccount(tx, storageAccountId, 'entitlements.changed');
	}
	return effective;
}

/** Oldest `limit` writable pouches stay active, the rest become read-only (and back). */
async function applyPouchLimit(tx: TenantTx, storageAccountId: string, limit: number) {
	const live = await tx
		.select({ id: pouches.id, state: pouches.state })
		.from(pouches)
		.where(
			and(
				eq(pouches.storageAccountId, storageAccountId),
				inArray(pouches.state, ['active', 'read_only']),
			),
		)
		.orderBy(asc(pouches.createdAt), asc(pouches.id));
	const keep = new Set(live.slice(0, Math.max(0, limit)).map((pouch) => pouch.id));
	const toActivate = live.filter((pouch) => keep.has(pouch.id) && pouch.state === 'read_only');
	const toFreeze = live.filter((pouch) => !keep.has(pouch.id) && pouch.state === 'active');
	if (toActivate.length > 0) {
		await tx
			.update(pouches)
			.set({ state: 'active' })
			.where(
				inArray(
					pouches.id,
					toActivate.map((p) => p.id),
				),
			);
	}
	if (toFreeze.length > 0) {
		await tx
			.update(pouches)
			.set({ state: 'read_only' })
			.where(
				inArray(
					pouches.id,
					toFreeze.map((p) => p.id),
				),
			);
	}
	for (const pouch of [...toActivate, ...toFreeze]) {
		await notifyAccount(tx, storageAccountId, 'pouch.state_changed', { pouch_id: pouch.id });
	}
}

export function refreshEntitlements(db: Database, storageAccountId: string) {
	return withTenantTx(db, storageAccountId, (tx) =>
		refreshEntitlementsInTx(tx, storageAccountId),
	);
}

/** Number of pouches counting toward the limit (archived count, deleted don't — 15 §7.5). */
export async function countedPouches(tx: TenantTx): Promise<number> {
	const rows = await tx
		.select({ id: pouches.id })
		.from(pouches)
		.where(ne(pouches.state, 'deleted'));
	return rows.length;
}
