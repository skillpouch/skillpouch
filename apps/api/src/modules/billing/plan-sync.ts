// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Plans follow the billing provider's products. Every product tagged with
 * metadata `plan=<slug>` is linked to the plan with that slug. Its name,
 * description, price and interval are copied over: users see the name set in
 * the provider, and checkout charges the provider's price.
 * A tagged product without a plan creates one from its `pouch_limit` and
 * `storage_bytes` metadata. Limits of an existing plan are never touched:
 * editing metadata must not silently change what paying users get.
 *
 * Runs when the API starts, hourly in the worker, from the admin dashboard,
 * and when a checkout finds no product for its plan.
 */
import { plans } from '@skillpouch/db';
import { eq, sql } from 'drizzle-orm';
import type { Deps } from '../../deps';
import type { PlanProduct } from './provider';

export interface PlanSyncResult {
	created: string[];
	linked: string[];
	updated: string[];
	skipped: { slug: string; reason: string }[];
}

export async function syncPlansFromProvider(deps: Deps): Promise<PlanSyncResult | null> {
	if (!deps.billing) return null;
	const products = await deps.billing.listPlanProducts();
	const result: PlanSyncResult = { created: [], linked: [], updated: [], skipped: [] };
	const seen = new Set<string>();
	for (const product of products) {
		if (seen.has(product.slug)) {
			result.skipped.push({ slug: product.slug, reason: 'another product has this slug' });
			continue;
		}
		seen.add(product.slug);
		const outcome = await syncOne(deps, product);
		if (typeof outcome === 'string') result[outcome].push(product.slug);
		else if (outcome) result.skipped.push({ slug: product.slug, reason: outcome.skipped });
	}
	if (
		result.created.length ||
		result.linked.length ||
		result.updated.length ||
		result.skipped.length
	)
		deps.log.info(result, 'plans synced from billing provider');
	return result;
}

async function syncOne(
	deps: Deps,
	product: PlanProduct,
): Promise<'created' | 'linked' | 'updated' | { skipped: string } | null> {
	const db = deps.db.admin;
	const [plan] = await db.select().from(plans).where(eq(plans.slug, product.slug));
	const [owner] = await db
		.select()
		.from(plans)
		.where(eq(plans.polarProductId, product.productId));
	if (owner && owner.slug !== product.slug)
		return { skipped: `product is linked to plan ${owner.slug}` };

	if (!plan) {
		if (product.pouchLimit === null || product.storageBytes === null)
			return { skipped: 'new plans need pouch_limit and storage_bytes metadata' };
		const [{ sort } = { sort: 0 }] = await db
			.select({ sort: sql<number>`coalesce(max(${plans.sort}), 0)::int` })
			.from(plans);
		await db.insert(plans).values({
			slug: product.slug,
			name: product.name,
			description: product.description,
			priceCents: product.priceCents,
			currency: product.currency,
			interval: product.interval,
			pouchLimit: product.pouchLimit,
			storageBytes: product.storageBytes,
			polarProductId: product.productId,
			sort: sort + 10,
		});
		return 'created';
	}
	if (plan.isDefault) return { skipped: 'the default plan stays free' };

	const linking = plan.polarProductId !== product.productId;
	const changed =
		plan.name !== product.name ||
		plan.description !== product.description ||
		plan.priceCents !== product.priceCents ||
		plan.currency !== product.currency ||
		plan.interval !== product.interval;
	if (!linking && !changed) return null;
	await db
		.update(plans)
		.set({
			polarProductId: product.productId,
			name: product.name,
			description: product.description,
			priceCents: product.priceCents,
			currency: product.currency,
			interval: product.interval,
			updatedAt: deps.now(),
		})
		.where(eq(plans.id, plan.id));
	if (plan.name !== product.name) await renameInEntitlements(deps, plan.slug, product.name);
	return linking ? 'linked' : 'updated';
}

/** Accounts cache their plan's name; a rename shows up right away instead of after the nightly refresh. */
async function renameInEntitlements(deps: Deps, slug: string, name: string): Promise<void> {
	await deps.db.admin.execute(sql`
		UPDATE storage_accounts
		SET entitlements = jsonb_set(entitlements, '{plan_name}', to_jsonb(${name}::text))
		WHERE entitlements->>'plan_slug' = ${slug}`);
}

const FALLBACK_INTERVAL_MS = 60_000;
const lastFallback = new WeakMap<Deps, number>();

/**
 * Syncs once when a checkout finds no product for its plan, at most once a
 * minute, so a plan created in the provider a moment ago works right away.
 */
export async function syncPlansOnMiss(deps: Deps): Promise<boolean> {
	const now = deps.now().getTime();
	if (now - (lastFallback.get(deps) ?? 0) < FALLBACK_INTERVAL_MS) return false;
	lastFallback.set(deps, now);
	try {
		await syncPlansFromProvider(deps);
		return true;
	} catch (error) {
		deps.log.warn({ err: error }, 'plan sync failed');
		return false;
	}
}
