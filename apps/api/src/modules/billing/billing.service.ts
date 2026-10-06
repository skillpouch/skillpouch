// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Billing state machine: webhooks are verified,
 * stored once in `billing_events` (idempotency) and applied; a daily
 * reconcile pulls every non-terminal subscription from the provider to fix
 * missed webhooks. Entitlements are recomputed after every change; nothing
 * is ever deleted on downgrade (extra pouches become read-only).
 */
import { billingEvents, plans, subscriptions } from '@skillpouch/db';
import { and, asc, eq, gt, isNull, notInArray, or, sql } from 'drizzle-orm';
import type { Deps } from '../../deps';
import { AppError } from '../../http/app-error';
import { appendAudit } from '../../security/audit';
import { withTenantTx } from '../../security/tenant-tx';
import { refreshEntitlementsInTx } from '../entitlements/entitlements.service';
import { normalizePolarSubscription } from './polar';
import type { BillingEvent, BillingProvider, NormalizedSubscription } from './provider';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
/** Statuses Polar never leaves; reconcile stops polling them. */
const TERMINAL = ['unpaid', 'incomplete_expired'];

export function requireBilling(deps: Deps): BillingProvider {
	if (!deps.billing) throw new AppError('billing_unavailable');
	return deps.billing;
}

/** Marks a stored event as applied. */
export async function markBillingEventProcessed(deps: Deps, provider: string, externalId: string) {
	await deps.db.app
		.update(billingEvents)
		.set({ processedAt: deps.now() })
		.where(and(eq(billingEvents.provider, provider), eq(billingEvents.externalId, externalId)));
}

/** Stores a verified event once; returns false for a duplicate delivery. */
export async function recordBillingEvent(
	deps: Deps,
	provider: string,
	event: BillingEvent,
): Promise<boolean> {
	const inserted = await deps.db.app
		.insert(billingEvents)
		.values({ provider, externalId: event.id, type: event.type, payload: event.payload })
		.onConflictDoNothing()
		.returning({ id: billingEvents.externalId });
	return inserted.length === 1;
}

/**
 * Upserts one subscription for its account and recomputes entitlements.
 * Webhooks can arrive out of order: a delivery whose provider modification
 * time is older than the stored one leaves the row unchanged.
 */
export async function applySubscription(
	deps: Deps,
	provider: string,
	sub: NormalizedSubscription,
): Promise<boolean> {
	if (!sub.storageAccountId || !UUID.test(sub.storageAccountId)) {
		deps.log.warn(
			{ subscription: sub.externalSubscriptionId },
			'billing: subscription without our account id',
		);
		return false;
	}
	const storageAccountId = sub.storageAccountId;
	await withTenantTx(deps.db.app, storageAccountId, async (tx) => {
		const [plan] = sub.productId
			? await tx
					.select({ id: plans.id })
					.from(plans)
					.where(eq(plans.polarProductId, sub.productId))
			: [];
		const values = {
			storageAccountId,
			planId: plan?.id ?? null,
			provider,
			externalCustomerId: sub.externalCustomerId,
			externalSubscriptionId: sub.externalSubscriptionId,
			status: sub.status,
			interval: sub.interval,
			amountCents: sub.amountCents,
			currentPeriodEnd: sub.currentPeriodEnd,
			cancelAtPeriodEnd: sub.cancelAtPeriodEnd,
			providerUpdatedAt: sub.providerUpdatedAt,
			updatedAt: deps.now(),
		};
		const written = await tx
			.insert(subscriptions)
			.values(values)
			.onConflictDoUpdate({
				target: subscriptions.externalSubscriptionId,
				set: values,
				setWhere: sql`${subscriptions.providerUpdatedAt} IS NULL
					OR excluded.provider_updated_at IS NULL
					OR excluded.provider_updated_at >= ${subscriptions.providerUpdatedAt}`,
			})
			.returning({ id: subscriptions.id });
		if (written.length === 0) {
			deps.log.info(
				{ subscription: sub.externalSubscriptionId },
				'billing: ignored an out-of-order subscription update',
			);
			return;
		}
		await refreshEntitlementsInTx(tx, storageAccountId, deps.now());
		await appendAudit(tx, {
			storageAccountId,
			actor: `billing:${provider}`,
			action: 'billing.subscription_updated',
			target: sub.externalSubscriptionId,
			details: { status: sub.status, plan_id: plan?.id ?? null },
		});
	});
	return true;
}

/** `billing.apply`: processes stored events not processed yet (webhook path + retries). */
export async function applyPendingBillingEvents(deps: Deps): Promise<number> {
	if (!deps.billing) return 0;
	const pending = await deps.db.app
		.select()
		.from(billingEvents)
		.where(isNull(billingEvents.processedAt))
		.orderBy(asc(billingEvents.createdAt))
		.limit(200);
	let applied = 0;
	for (const row of pending) {
		const payload = row.payload as { type?: string; data?: Record<string, unknown> };
		if (row.type.startsWith('subscription.') && payload.data) {
			if (
				await applySubscription(
					deps,
					row.provider,
					normalizePolarSubscription(payload.data),
				)
			)
				applied += 1;
		}
		await markBillingEventProcessed(deps, row.provider, row.externalId);
	}
	return applied;
}

/** `billing.reconcile`: pulls every non-terminal subscription from the provider. */
export async function reconcileSubscriptions(deps: Deps): Promise<number> {
	const provider = deps.billing;
	if (!provider) return 0;
	const open = await deps.db.maintenance
		.select({ id: subscriptions.externalSubscriptionId })
		.from(subscriptions)
		.where(
			and(
				eq(subscriptions.provider, provider.name),
				notInArray(subscriptions.status, TERMINAL),
				// A canceled subscription is final once its access period is over.
				or(
					sql`${subscriptions.status} <> 'canceled'`,
					gt(subscriptions.currentPeriodEnd, deps.now()),
				),
			),
		);
	let fixed = 0;
	for (const { id } of open) {
		try {
			const current = await provider.fetchSubscription(id);
			if (current && (await applySubscription(deps, provider.name, current))) fixed += 1;
		} catch (error) {
			deps.log.warn(
				{ err: error, subscription: id },
				'billing reconcile failed for one subscription',
			);
		}
	}
	return fixed;
}
