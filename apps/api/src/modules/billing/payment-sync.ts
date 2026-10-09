// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Earnings follow the billing provider's charges (Polar orders): copied into
 * `payments` for the admin dashboard. Refunds change old charges, so each run
 * reads back a few weeks past the newest one it has.
 *
 * Runs when an `order.*` webhook arrives, every half hour in the worker, and
 * from the admin dashboard.
 */
import { payments, plans, storageAccounts } from '@skillpouch/db';
import { eq, inArray, max, sql } from 'drizzle-orm';
import type { Deps } from '../../deps';
import { addSeconds } from '../../lib/dates';

/** How far back past the newest stored charge refunds are looked for. */
const REFUND_WINDOW_DAYS = 45;
const CHUNK = 200;

export async function syncPaymentsFromProvider(deps: Deps): Promise<number | null> {
	const provider = deps.billing;
	if (!provider) return null;
	const db = deps.db.maintenance;
	const [latest] = await db
		.select({ at: max(payments.createdAt) })
		.from(payments)
		.where(eq(payments.provider, provider.name));
	const since = latest?.at ? addSeconds(latest.at, -REFUND_WINDOW_DAYS * 86400) : null;
	const found = await provider.listPayments(since);
	if (!found.length) return 0;

	const productIds = [...new Set(found.flatMap((p) => (p.productId ? [p.productId] : [])))];
	const planBy = new Map(
		productIds.length
			? (
					await db
						.select({ id: plans.id, product: plans.polarProductId })
						.from(plans)
						.where(inArray(plans.polarProductId, productIds))
				).map((row) => [row.product, row.id])
			: [],
	);
	const accountIds = [
		...new Set(found.flatMap((p) => (p.storageAccountId ? [p.storageAccountId] : []))),
	];
	// Customers created outside this server (or since deleted) point nowhere.
	const known = new Set(
		accountIds.length
			? (
					await db
						.select({ id: storageAccounts.id })
						.from(storageAccounts)
						.where(inArray(storageAccounts.id, accountIds.filter(isUuid)))
				).map((row) => row.id)
			: [],
	);
	for (let start = 0; start < found.length; start += CHUNK) {
		const rows = found.slice(start, start + CHUNK).map((payment) => ({
			id: payment.id,
			provider: provider.name,
			storageAccountId:
				payment.storageAccountId && known.has(payment.storageAccountId)
					? payment.storageAccountId
					: null,
			planId: (payment.productId && planBy.get(payment.productId)) || null,
			status: payment.status,
			currency: payment.currency,
			amountCents: payment.amountCents,
			netCents: payment.netCents,
			taxCents: payment.taxCents,
			refundedCents: payment.refundedCents,
			createdAt: payment.createdAt,
			updatedAt: deps.now(),
		}));
		await db
			.insert(payments)
			.values(rows)
			.onConflictDoUpdate({
				target: payments.id,
				set: {
					status: sql`excluded.status`,
					amountCents: sql`excluded.amount_cents`,
					netCents: sql`excluded.net_cents`,
					taxCents: sql`excluded.tax_cents`,
					refundedCents: sql`excluded.refunded_cents`,
					planId: sql`coalesce(excluded.plan_id, ${payments.planId})`,
					updatedAt: sql`excluded.updated_at`,
				},
			});
	}
	return found.length;
}

function isUuid(value: string): boolean {
	return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}
