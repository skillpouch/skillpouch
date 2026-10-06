// SPDX-License-Identifier: AGPL-3.0-only
/** Billing routes: checkout, customer portal, subscription, webhooks. */
import { BillingCheckout, BillingUrl, Timestamp } from '@skillpouch/contracts';
import { plans, subscriptions } from '@skillpouch/db';
import { and, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import type { Deps } from '../../deps';
import { AppError } from '../../http/app-error';
import { sessionOf } from '../../http/principal';
import { rawSchema } from '../../http/serialization';
import type { ZodApp } from '../../http/zod-app';
import { withTenantTx } from '../../security/tenant-tx';
import {
	applySubscription,
	markBillingEventProcessed,
	recordBillingEvent,
	requireBilling,
} from './billing.service';

const SubscriptionView = z.object({
	status: z.string(),
	plan_slug: z.string().nullable(),
	interval: z.string().nullable(),
	amount_cents: z.number().int(),
	current_period_end: Timestamp.nullable(),
	cancel_at_period_end: z.boolean(),
});

export async function billingRoutes(app: ZodApp, deps: Deps) {
	app.get(
		'/v1/billing',
		{
			config: { auth: 'session' },
			schema: {
				tags: ['billing'],
				summary:
					'This account’s subscriptions (newest first) and whether billing is available',
				response: {
					200: z.object({
						available: z.boolean(),
						subscriptions: z.array(SubscriptionView),
					}),
				},
			},
		},
		async (request) => {
			const principal = sessionOf(request);
			return withTenantTx(deps.db.app, principal.storageAccountId, async (tx) => {
				const rows = await tx
					.select({ sub: subscriptions, slug: plans.slug })
					.from(subscriptions)
					.leftJoin(plans, eq(plans.id, subscriptions.planId))
					.orderBy(desc(subscriptions.updatedAt));
				return {
					available: deps.billing !== null,
					subscriptions: rows.map(({ sub, slug }) => ({
						status: sub.status,
						plan_slug: slug,
						interval: sub.interval,
						amount_cents: sub.amountCents,
						current_period_end: sub.currentPeriodEnd?.toISOString() ?? null,
						cancel_at_period_end: sub.cancelAtPeriodEnd,
					})),
				};
			});
		},
	);

	app.post(
		'/v1/billing/checkout',
		{
			config: { auth: 'session' },
			schema: {
				tags: ['billing'],
				summary: 'Start a hosted checkout for a paid plan',
				body: BillingCheckout,
				response: { 200: BillingUrl },
			},
		},
		async (request) => {
			const principal = sessionOf(request);
			const provider = requireBilling(deps);
			const [plan] = await deps.db.app
				.select()
				.from(plans)
				.where(and(eq(plans.slug, request.body.plan_slug), eq(plans.isActive, true)));
			if (!plan || !plan.polarProductId || plan.priceCents === 0)
				throw new AppError('not_found');
			return provider.createCheckout({
				storageAccountId: principal.storageAccountId,
				email: principal.email,
				productId: plan.polarProductId,
				successUrl: `${deps.env.WEB_ORIGIN}/app/billing?ok=1`,
			});
		},
	);

	app.post(
		'/v1/billing/portal',
		{
			config: { auth: 'session' },
			schema: {
				tags: ['billing'],
				summary: 'Customer portal link (manage / cancel)',
				response: { 200: BillingUrl },
			},
		},
		async (request) =>
			requireBilling(deps).createPortalSession({
				storageAccountId: sessionOf(request).storageAccountId,
			}),
	);

	// Webhooks need the exact bytes for the signature, so this route parses JSON itself.
	await app.register(async (scope) => {
		scope.addContentTypeParser(
			'application/json',
			{ parseAs: 'buffer' },
			(_request, body, done) => done(null, body),
		);
		scope.post(
			'/v1/billing/webhooks/polar',
			{
				config: { auth: 'public', raw: true },
				bodyLimit: 512 * 1024,
				schema: {
					tags: ['billing'],
					summary: 'Polar webhooks (Standard Webhooks signature, idempotent by event id)',
					response: { 200: rawSchema(z.object({ received: z.boolean() })) },
				},
			},
			async (request) => {
				const provider = requireBilling(deps);
				if (!Buffer.isBuffer(request.body))
					throw new AppError('webhook_invalid', { reason: 'body' });
				const event = await provider.verifyWebhook(request.body, request.headers);
				const fresh = await recordBillingEvent(deps, provider.name, event);
				if (fresh) {
					if (event.subscription)
						await applySubscription(deps, provider.name, event.subscription);
					await markBillingEventProcessed(deps, provider.name, event.id);
				}
				return { received: true };
			},
		);
	});
}
