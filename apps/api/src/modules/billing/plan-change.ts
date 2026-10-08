// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Moving a paying account to another paid plan. The provider allows one
 * subscription per customer, so a subscriber never checks out again: their
 * subscription switches product instead. Upgrades are charged the prorated
 * difference right away; downgrades get the unused part credited on the next
 * renewal. Either way the new plan applies at once.
 *
 * Hidden plans (not public) are never sold. An account an admin gave one to
 * can't pay for another plan either: it keeps the gift until an admin changes it.
 */
import { plans, storageAccounts, subscriptions } from '@skillpouch/db';
import { and, desc, eq, inArray } from 'drizzle-orm';
import type { Deps } from '../../deps';
import { AppError } from '../../http/app-error';
import { withTenantTx } from '../../security/tenant-tx';
import { applySubscription, requireBilling } from './billing.service';
import { syncPlansOnMiss } from './plan-sync';

/** Statuses that still bill the customer; such a subscription is changed, not replaced. */
const OPEN_STATUSES = ['active', 'trialing', 'past_due'];

type Plan = typeof plans.$inferSelect;

/** An active, public paid plan that can be sold, syncing from the provider once if it has no product yet. */
export async function findPaidPlan(
	deps: Deps,
	slug: string,
): Promise<Plan & { polarProductId: string }> {
	const find = async () =>
		(
			await deps.db.app
				.select()
				.from(plans)
				.where(
					and(eq(plans.slug, slug), eq(plans.isActive, true), eq(plans.isPublic, true)),
				)
		)[0];
	let plan = await find();
	if (!plan?.polarProductId && (await syncPlansOnMiss(deps))) plan = await find();
	if (!plan || !plan.polarProductId || plan.priceCents === 0) throw new AppError('not_found');
	return { ...plan, polarProductId: plan.polarProductId };
}

/** Refuses payments for an account whose plan is a hidden one given by an admin. */
export async function assertCanPay(deps: Deps, storageAccountId: string): Promise<void> {
	const [account] = await withTenantTx(deps.db.app, storageAccountId, (tx) =>
		tx
			.select({ entitlements: storageAccounts.entitlements })
			.from(storageAccounts)
			.where(eq(storageAccounts.id, storageAccountId)),
	);
	const current = account?.entitlements;
	if (!current || current.source === 'default' || current.source === 'subscription') return;
	const [plan] = await deps.db.app
		.select({ isPublic: plans.isPublic })
		.from(plans)
		.where(eq(plans.slug, current.plan_slug));
	if (plan && !plan.isPublic)
		throw new AppError('plan_change_unavailable', { reason: 'granted_plan' });
}

/** The account's subscription that is still billing, newest first. */
export async function openSubscription(deps: Deps, storageAccountId: string) {
	const [row] = await withTenantTx(deps.db.app, storageAccountId, (tx) =>
		tx
			.select()
			.from(subscriptions)
			.where(inArray(subscriptions.status, OPEN_STATUSES))
			.orderBy(desc(subscriptions.updatedAt))
			.limit(1),
	);
	return row ?? null;
}

/** Price per month, so monthly and yearly plans compare. */
export function monthlyCents(cents: number, interval: string | null): number {
	return interval === 'year' ? cents / 12 : cents;
}

/** Switches the account's subscription to `slug`; returns whether anything changed. */
export async function changePlan(
	deps: Deps,
	storageAccountId: string,
	slug: string,
): Promise<boolean> {
	const provider = requireBilling(deps);
	await assertCanPay(deps, storageAccountId);
	const target = await findPaidPlan(deps, slug);
	const current = await openSubscription(deps, storageAccountId);
	if (!current) throw new AppError('plan_change_unavailable', { reason: 'no_subscription' });
	if (current.cancelAtPeriodEnd)
		throw new AppError('plan_change_unavailable', { reason: 'cancel_scheduled' });
	if (current.planId === target.id) return false;

	const upgrade =
		monthlyCents(target.priceCents, target.interval) >
		monthlyCents(current.amountCents, current.interval);
	const updated = await provider.changePlan({
		externalSubscriptionId: current.externalSubscriptionId,
		productId: target.polarProductId,
		proration: upgrade ? 'now' : 'next_invoice',
	});
	deps.log.info(
		{ subscription: current.externalSubscriptionId, plan: target.slug, upgrade },
		'billing: plan changed',
	);
	// The webhook follows, but the page shouldn't wait for it.
	await applySubscription(deps, provider.name, { ...updated, storageAccountId });
	return true;
}
