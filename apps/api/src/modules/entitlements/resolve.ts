// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Entitlement resolution — one pure function (plan 18 §3.3):
 *
 *   base plan = highest-ranked of
 *       active paid subscription's plan (active | trialing | past_due within 7 days
 *                                       | canceled with period_end > now)
 *       active plan grants
 *       default (free) plan
 *   effective.pouch_limit   = override.pouch_limit   ?? base.pouch_limit
 *   effective.storage_bytes = override.storage_bytes ?? base.storage_bytes
 *
 * "Highest-ranked" = larger storage, then larger pouch limit.
 */
import type { EntitlementsJson } from '@skillpouch/db';

export interface PlanLimits {
	slug: string;
	name: string;
	pouchLimit: number;
	storageBytes: number;
}

export interface SubscriptionInput {
	plan: PlanLimits | null;
	status: string;
	currentPeriodEnd: Date | null;
	updatedAt: Date;
}

export interface GrantInput {
	plan: PlanLimits;
	startsAt: Date;
	endsAt: Date | null;
	revokedAt: Date | null;
}

export interface OverrideInput {
	pouchLimit: number | null;
	storageBytes: number | null;
	expiresAt: Date | null;
}

export interface ResolveInput {
	defaultPlan: PlanLimits;
	subscriptions: SubscriptionInput[];
	grants: GrantInput[];
	override: OverrideInput | null;
	now: Date;
}

const PAST_DUE_GRACE_MS = 7 * 24 * 3600 * 1000;

export function isSubscriptionEntitled(sub: SubscriptionInput, now: Date): boolean {
	const periodEnd = sub.currentPeriodEnd?.getTime() ?? 0;
	switch (sub.status) {
		case 'active':
		case 'trialing':
			return true;
		case 'past_due':
			return now.getTime() - sub.updatedAt.getTime() <= PAST_DUE_GRACE_MS;
		case 'canceled':
			return periodEnd > now.getTime();
		default:
			return false;
	}
}

function outranks(a: PlanLimits, b: PlanLimits): boolean {
	if (a.storageBytes !== b.storageBytes) return a.storageBytes > b.storageBytes;
	return a.pouchLimit > b.pouchLimit;
}

export function resolveEntitlements(input: ResolveInput): EntitlementsJson {
	let base = input.defaultPlan;
	let source: EntitlementsJson['source'] = 'default';

	for (const sub of input.subscriptions) {
		if (sub.plan && isSubscriptionEntitled(sub, input.now) && outranks(sub.plan, base)) {
			base = sub.plan;
			source = 'subscription';
		}
	}
	for (const grant of input.grants) {
		const active =
			grant.revokedAt === null &&
			grant.startsAt.getTime() <= input.now.getTime() &&
			(grant.endsAt === null || grant.endsAt.getTime() > input.now.getTime());
		if (active && outranks(grant.plan, base)) {
			base = grant.plan;
			source = 'grant';
		}
	}

	const override =
		input.override &&
		(input.override.expiresAt === null || input.override.expiresAt.getTime() > input.now.getTime())
			? input.override
			: null;
	const overridden =
		override !== null && (override.pouchLimit !== null || override.storageBytes !== null);

	return {
		plan_slug: base.slug,
		plan_name: base.name,
		source: overridden ? 'override' : source,
		pouch_limit: override?.pouchLimit ?? base.pouchLimit,
		storage_bytes: override?.storageBytes ?? base.storageBytes,
	};
}
