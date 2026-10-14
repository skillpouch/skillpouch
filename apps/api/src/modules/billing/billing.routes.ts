// SPDX-License-Identifier: AGPL-3.0-only
/** Billing routes: checkout, plan changes, customer portal, subscription, webhooks. */
import { BillingCheckout, BillingUrl, Timestamp } from '@skillpouch/contracts';
import { plans, subscriptions } from '@skillpouch/db';
import { desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import type { Deps } from '../../deps';
import { AppError } from '../../http/app-error';
import { sessionOf } from '../../http/principal';
import { rawSchema } from '../../http/serialization';
import type { ZodApp } from '../../http/zod-app';
import { withTenantTx } from '../../security/tenant-tx';
import { assertCanPay, changePlan, findPaidPlan, openSubscription } from './plan-change';
import {
	applySubscription,
	markBillingEventProcessed,
	recordBillingEvent,
	requireBilling,
	syncAccountSubscriptions,
	syncForEvent,
} from './billing.service';
import type { BillingDocument } from './provider';

const SubscriptionView = z.object({
	status: z.string(),
	plan_slug: z.string().nullable(),
	interval: z.string().nullable(),
	amount_cents: z.number().int(),
	current_period_end: Timestamp.nullable(),
	cancel_at_period_end: z.boolean(),
});

const Invoice = z.object({
	id: z.string(),
	created_at: Timestamp,
	description: z.string(),
	amount_cents: z.number().int(),
	currency: z.string(),
	status: z.enum(['paid', 'refunded', 'partially_refunded', 'pending', 'failed']),
	invoice_available: z.boolean(),
	receipt_available: z.boolean(),
});

const InvoiceList = z.object({ invoices: z.array(Invoice) });

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
			await assertCanPay(deps, principal.storageAccountId);
			const plan = await findPaidPlan(deps, request.body.plan_slug);
			if (await openSubscription(deps, principal.storageAccountId))
				throw new AppError('subscription_exists');
			return provider.createCheckout({
				storageAccountId: principal.storageAccountId,
				email: principal.email,
				productId: plan.polarProductId,
				successUrl: `${deps.env.WEB_ORIGIN}/account/billing?ok=1`,
			});
		},
	);

	app.post(
		'/v1/billing/change-plan',
		{
			config: { auth: 'session' },
			schema: {
				tags: ['billing'],
				summary:
					'Switch the current subscription to another paid plan (upgrades charge the prorated difference now)',
				body: BillingCheckout,
				response: { 200: z.object({ changed: z.boolean() }) },
			},
		},
		async (request) => ({
			changed: await changePlan(
				deps,
				sessionOf(request).storageAccountId,
				request.body.plan_slug,
			),
		}),
	);

	app.get(
		'/v1/billing/invoices',
		{
			config: { auth: 'session' },
			schema: {
				tags: ['billing'],
				summary: 'Recent charges of this account (newest first)',
				response: { 200: InvoiceList },
			},
		},
		async (request) => {
			const principal = sessionOf(request);
			if (!deps.billing) return { invoices: [] };
			const invoices = await deps.billing.listInvoices(principal.storageAccountId, 24);
			return {
				invoices: invoices.map((invoice) => ({
					id: invoice.id,
					created_at: invoice.createdAt.toISOString(),
					description: invoice.description,
					amount_cents: invoice.amountCents,
					currency: invoice.currency,
					status: invoice.status,
					invoice_available: invoice.invoiceAvailable,
					receipt_available: invoice.receiptAvailable,
				})),
			};
		},
	);

	const documentRoute = (path: string, document: BillingDocument, summary: string) =>
		app.get(
			path,
			{
				config: { auth: 'session' },
				schema: {
					tags: ['billing'],
					summary,
					params: z.object({ invoiceId: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/) }),
					response: { 200: BillingUrl },
				},
			},
			async (request) => {
				const url = await requireBilling(deps).documentUrl(
					sessionOf(request).storageAccountId,
					request.params.invoiceId,
					document,
				);
				if (!url) throw new AppError('not_found');
				return { url };
			},
		);
	documentRoute(
		'/v1/billing/invoices/:invoiceId/pdf',
		'invoice',
		'Link to the invoice PDF of one of this account’s charges (generated on first request)',
	);
	documentRoute(
		'/v1/billing/invoices/:invoiceId/receipt',
		'receipt',
		'Link to the receipt PDF of one of this account’s charges',
	);

	app.post(
		'/v1/billing/sync',
		{
			config: { auth: 'session' },
			schema: {
				tags: ['billing'],
				summary:
					'Pull this account’s subscriptions from the billing provider (for late webhooks)',
				response: { 200: z.object({ changed: z.number().int() }) },
			},
		},
		async (request) => ({
			changed: await syncAccountSubscriptions(deps, sessionOf(request).storageAccountId),
		}),
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
				// A failed plan or payment sync leaves the event pending; `billing.apply` retries it.
				const done = !fresh || (await syncForEvent(deps, event.type));
				if (fresh && done) {
					if (event.subscription)
						await applySubscription(deps, provider.name, event.subscription);
					await markBillingEventProcessed(deps, provider.name, event.id);
				}
				return { received: true };
			},
		);
	});
}
