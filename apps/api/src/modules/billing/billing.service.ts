// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Billing state machine: webhooks are verified,
 * stored once in `billing_events` (idempotency) and applied; a daily
 * reconcile pulls every non-terminal subscription from the provider to fix
 * missed webhooks, and the billing page pulls its own account's on open. Entitlements are recomputed after every change; nothing
 * is ever deleted on downgrade (extra pouches become read-only).
 */
import { billingEvents, plans, subscriptions } from '@skillpouch/db';
import { and, asc, eq, gt, isNull, notInArray, or, sql } from 'drizzle-orm';
import type { Deps } from '../../deps';
import { AppError } from '../../http/app-error';
import { appendAudit } from '../../security/audit';
import { withTenantTx } from '../../security/tenant-tx';
import { refreshEntitlementsInTx } from '../entitlements/entitlements.service';
import { syncPaymentsFromProvider } from './payment-sync';
import { syncPlansFromProvider } from './plan-sync';
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
	try {
		await upsertSubscription(deps, provider, sub, storageAccountId);
	} catch (error) {
		if (!isMissingAccount(error)) throw error;
		// Deleted, or created on another instance sharing the Polar
		// organization: its events can never apply, so retrying is pointless.
		deps.log.warn(
			{ subscription: sub.externalSubscriptionId, storageAccountId },
			'billing: subscription for an unknown account',
		);
		return false;
	}
	return true;
}

/** A foreign-key violation on the subscription's account (Postgres 23503). */
function isMissingAccount(error: unknown): boolean {
	const cause = (error as { cause?: { code?: string; constraint?: string } }).cause;
	return cause?.code === '23503' && cause.constraint === 'subscriptions_storage_account_id_fkey';
}

async function upsertSubscription(
	deps: Deps,
	provider: string,
	sub: NormalizedSubscription,
	storageAccountId: string,
) {
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
}

/** A product was created or edited in the provider: its plan follows right away. */
export function isProductEvent(type: string): boolean {
	return type.startsWith('product.');
}

/** Syncs plans for a product event; false (and a warning) when the provider is unreachable. */
export async function syncPlansForEvent(deps: Deps): Promise<boolean> {
	try {
		await syncPlansFromProvider(deps);
		return true;
	} catch (error) {
		deps.log.warn({ err: error }, 'plan sync after a product webhook failed');
		return false;
	}
}

export function isOrderEvent(type: string): boolean {
	return type.startsWith('order.');
}

/** Syncs earnings for an order event; false (and a warning) when the provider is unreachable. */
export async function syncPaymentsForEvent(deps: Deps): Promise<boolean> {
	try {
		await syncPaymentsFromProvider(deps);
		return true;
	} catch (error) {
		deps.log.warn({ err: error }, 'payment sync after an order webhook failed');
		return false;
	}
}

/** Runs the sync a provider event calls for; false leaves the event pending. */
export async function syncForEvent(deps: Deps, type: string): Promise<boolean> {
	if (isProductEvent(type)) return syncPlansForEvent(deps);
	if (isOrderEvent(type)) return syncPaymentsForEvent(deps);
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
	let failed = 0;
	// One sync covers every pending product (or order) event.
	let plansSynced: boolean | null = null;
	let paymentsSynced: boolean | null = null;
	for (const row of pending) {
		const payload = row.payload as { type?: string; data?: Record<string, unknown> };
		if (isProductEvent(row.type)) {
			plansSynced ??= await syncPlansForEvent(deps);
			if (!plansSynced) continue;
		} else if (isOrderEvent(row.type)) {
			paymentsSynced ??= await syncPaymentsForEvent(deps);
			if (!paymentsSynced) continue;
		} else if (row.type.startsWith('subscription.') && payload.data) {
			try {
				if (
					await applySubscription(
						deps,
						row.provider,
						normalizePolarSubscription(payload.data),
					)
				)
					applied += 1;
			} catch (error) {
				// Stays pending for the next run without holding back the events after it.
				deps.log.error(
					{ err: error, event: row.externalId },
					'billing: applying a stored event failed',
				);
				failed += 1;
				continue;
			}
		}
		await markBillingEventProcessed(deps, row.provider, row.externalId);
	}
	// The run still fails, so a stuck event shows on the admin dashboard.
	if (failed > 0)
		throw new AppError('internal_error', { reason: 'billing events left pending', failed });
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

/** Last pull per account; the billing page asks on every open. */
const lastAccountSync = new Map<string, number>();
const ACCOUNT_SYNC_INTERVAL_MS = 10_000;

/**
 * Pulls one account's subscriptions from the provider and applies the ones
 * that changed, so a payment shows up even when its webhook is late or never
 * arrives. Returns how many changed.
 */
export async function syncAccountSubscriptions(
	deps: Deps,
	storageAccountId: string,
): Promise<number> {
	const provider = deps.billing;
	if (!provider) return 0;
	const now = deps.now().getTime();
	if (now - (lastAccountSync.get(storageAccountId) ?? 0) < ACCOUNT_SYNC_INTERVAL_MS) return 0;
	lastAccountSync.set(storageAccountId, now);

	const remote = await provider.listSubscriptions(storageAccountId);
	const stored = await withTenantTx(deps.db.app, storageAccountId, (tx) =>
		tx.select().from(subscriptions),
	);
	let changed = 0;
	for (const sub of remote) {
		if (sub.storageAccountId !== storageAccountId) continue;
		const known = stored.find(
			(row) => row.externalSubscriptionId === sub.externalSubscriptionId,
		);
		const same =
			known &&
			known.status === sub.status &&
			known.cancelAtPeriodEnd === sub.cancelAtPeriodEnd &&
			known.currentPeriodEnd?.getTime() === sub.currentPeriodEnd?.getTime() &&
			known.providerUpdatedAt?.getTime() === sub.providerUpdatedAt?.getTime();
		if (!same && (await applySubscription(deps, provider.name, sub))) changed += 1;
	}
	return changed;
}
