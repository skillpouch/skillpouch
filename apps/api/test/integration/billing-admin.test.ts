// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Plans, billing and the admin dashboard: Polar checkout +
 * signed webhooks → entitlements, reconcile, admin grants/overrides/roles/
 * suspension, step-up and audit. Polar's HTTP API is replaced by a recorder;
 * signature verification is the real code.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PolarProvider, signStandardWebhook } from '../../src/modules/billing/polar';
import { syncPlansFromProvider } from '../../src/modules/billing/plan-sync';
import { signIn, type BrowserClient } from '../helpers/clients';
import { authorizeCli, setupAccount, type Account } from '../helpers/flows';
import { createHarness, type Harness } from '../helpers/harness';

const WEBHOOK_SECRET = 'polar-test-webhook-secret';
const PRODUCT = 'prod_supporter';

interface Call {
	method: string;
	url: string;
	body: Record<string, unknown> | null;
}

describe('billing and admin', () => {
	let h: Harness;
	let alice: Account;
	let admin: BrowserClient;
	const calls: Call[] = [];
	let remoteSubscription: Record<string, unknown> = {};
	const orders = [
		{
			id: 'ord_2',
			created_at: '2026-10-06T10:00:00Z',
			status: 'paid',
			total_amount: 500,
			currency: 'usd',
			customer_id: 'cus_1',
			is_invoice_generated: true,
			product: { name: 'Supporter — monthly' },
		},
		{
			id: 'ord_1',
			created_at: '2026-09-06T10:00:00Z',
			status: 'refunded',
			total_amount: 500,
			currency: 'usd',
			customer_id: 'cus_1',
			is_invoice_generated: false,
			product: { name: 'Supporter — monthly' },
		},
	];
	const foreignOrder = { ...orders[0]!, id: 'ord_other', customer_id: 'cus_other' };
	let remoteProducts: Record<string, unknown>[] = [];
	const polarProduct = (
		id: string,
		name: string,
		metadata: Record<string, unknown>,
		priceCents = 500,
	) => ({
		id,
		name,
		description: `${name} description`,
		is_archived: false,
		recurring_interval: 'month',
		metadata,
		prices: [
			{
				amount_type: 'fixed',
				price_amount: priceCents,
				price_currency: 'usd',
				is_archived: false,
			},
		],
	});

	const fakePolar: typeof fetch = async (input, init) => {
		const url = String(input);
		const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null;
		calls.push({ method: init?.method ?? 'GET', url, body });
		const json = (value: unknown) =>
			new Response(JSON.stringify(value), {
				status: 200,
				headers: { 'content-type': 'application/json' },
			});
		if (url.endsWith('/v1/checkouts/')) {
			if (String(body?.customer_email).endsWith('@nomail.test')) {
				return new Response(
					JSON.stringify({
						error: 'RequestValidationError',
						detail: [{ loc: ['body', 'CheckoutProductsCreate', 'customer_email'] }],
					}),
					{ status: 422, headers: { 'content-type': 'application/json' } },
				);
			}
			return json({ url: 'https://sandbox.polar.sh/checkout/abc' });
		}
		if (url.endsWith('/v1/customer-sessions/'))
			return json({ customer_portal_url: 'https://sandbox.polar.sh/portal/xyz' });
		if (url.includes('/v1/subscriptions/')) return json(remoteSubscription);
		if (url.includes('/v1/customers/external/')) {
			return url.endsWith(encodeURIComponent(alice.accountId))
				? json({ id: 'cus_1' })
				: new Response('{}', { status: 404 });
		}
		if (url.includes('/v1/orders/?customer_id=cus_1')) return json({ items: orders });
		const order = /\/v1\/orders\/([^/?]+)(\/invoice)?$/.exec(url);
		if (order) {
			const found = [...orders, foreignOrder].find((item) => item.id === order[1]);
			if (!found) return new Response('{}', { status: 404 });
			return order[2]
				? json({ url: `https://polar.test/invoices/${found.id}.pdf` })
				: json(found);
		}
		if (url.includes('/v1/products/?'))
			return json({ items: remoteProducts, pagination: { max_page: 1 } });
		if (url.includes('/v1/products')) return json({ id: 'prod_new' });
		return new Response('not found', { status: 404 });
	};

	/** Delivers a signed Polar webhook. */
	async function webhook(
		payload: unknown,
		options: { id?: string; secret?: string; timestamp?: number } = {},
	) {
		const body = JSON.stringify(payload);
		const id = options.id ?? `evt_${Math.random().toString(36).slice(2)}`;
		const timestamp = options.timestamp ?? Math.floor(Date.now() / 1000);
		return h.app.inject({
			method: 'POST',
			url: '/v1/billing/webhooks/polar',
			headers: {
				'content-type': 'application/json',
				'webhook-id': id,
				'webhook-timestamp': String(timestamp),
				'webhook-signature': `v1,${signStandardWebhook(options.secret ?? WEBHOOK_SECRET, id, timestamp, body)}`,
			},
			payload: body,
		});
	}

	function subscriptionEvent(type: string, overrides: Record<string, unknown> = {}) {
		return {
			type,
			data: {
				id: 'sub_1',
				status: 'active',
				customer_id: 'cus_1',
				customer: { external_id: alice.accountId },
				product_id: PRODUCT,
				recurring_interval: 'month',
				amount: 500,
				current_period_end: new Date(Date.now() + 30 * 86400_000).toISOString(),
				cancel_at_period_end: false,
				...overrides,
			},
		};
	}

	const entitlements = async (client: BrowserClient) =>
		(await client.get('/v1/me')).body.data.account.entitlements;

	beforeAll(async () => {
		h = await createHarness(
			{},
			{
				configure: (deps) => {
					deps.billing = new PolarProvider({
						accessToken: 'polar_token',
						webhookSecret: WEBHOOK_SECRET,
						server: 'sandbox',
						fetch: fakePolar,
					});
				},
			},
		);
		await h.owner.query(`UPDATE plans SET polar_product_id = $1 WHERE slug = 'supporter'`, [
			PRODUCT,
		]);
		alice = await setupAccount(h, 'alice@skillpouch.test');
		admin = await signIn(h, 'admin@skillpouch.test');
	});
	afterAll(async () => {
		await h.close();
	});

	describe('invoices', () => {
		it('lists the account’s charges newest first', async () => {
			const response = await alice.browser.get('/v1/billing/invoices');
			expect(response.body.data.invoices).toEqual([
				{
					id: 'ord_2',
					created_at: '2026-10-06T10:00:00.000Z',
					description: 'Supporter — monthly',
					amount_cents: 500,
					currency: 'usd',
					status: 'paid',
					invoice_available: true,
				},
				expect.objectContaining({
					id: 'ord_1',
					status: 'refunded',
					invoice_available: false,
				}),
			]);
		});

		it('returns an empty list for accounts that never paid', async () => {
			const response = await admin.get('/v1/billing/invoices');
			expect(response.body.data.invoices).toEqual([]);
		});

		it('links only this account’s generated invoices', async () => {
			const pdf = await alice.browser.get('/v1/billing/invoices/ord_2/pdf');
			expect(pdf.body.data.url).toBe('https://polar.test/invoices/ord_2.pdf');
			expect((await alice.browser.get('/v1/billing/invoices/ord_1/pdf')).status).toBe(404);
			expect((await alice.browser.get('/v1/billing/invoices/ord_other/pdf')).status).toBe(
				404,
			);
			expect((await alice.browser.get('/v1/billing/invoices/ord_missing/pdf')).status).toBe(
				404,
			);
			expect((await alice.browser.get('/v1/billing/invoices/..%2Fx/pdf')).status).toBe(400);
			expect((await admin.get('/v1/billing/invoices/ord_2/pdf')).status).toBe(404);
		});
	});

	describe('plans and checkout', () => {
		it('lists public plans', async () => {
			const plans = (await alice.browser.get('/v1/plans')).body.data.plans;
			expect(plans.map((plan: { slug: string }) => plan.slug)).toEqual(['free', 'supporter']);
		});

		it('creates a Polar checkout bound to the storage account', async () => {
			const response = await alice.browser.post('/v1/billing/checkout', {
				plan_slug: 'supporter',
			});
			expect(response.body.data.url).toBe('https://sandbox.polar.sh/checkout/abc');
			expect(calls.at(-1)?.body).toMatchObject({
				products: [PRODUCT],
				external_customer_id: alice.accountId,
			});
			expect(
				(await alice.browser.post('/v1/billing/checkout', { plan_slug: 'free' })).status,
			).toBe(404);
		});

		it('drops an email Polar refuses, so the checkout asks for one', async () => {
			const carol = await setupAccount(h, 'carol@nomail.test');
			const response = await carol.browser.post('/v1/billing/checkout', {
				plan_slug: 'supporter',
			});
			expect(response.body.data.url).toBe('https://sandbox.polar.sh/checkout/abc');
			const [refused, retried] = calls.slice(-2).map((call) => call.body);
			expect(refused).toMatchObject({ customer_email: 'carol@nomail.test' });
			expect(retried).not.toHaveProperty('customer_email');
			expect(retried).toMatchObject({ external_customer_id: carol.accountId });
		});

		it('opens the customer portal', async () => {
			const response = await alice.browser.post('/v1/billing/portal');
			expect(response.body.data.url).toBe('https://sandbox.polar.sh/portal/xyz');
		});
	});

	describe('webhooks', () => {
		it('rejects bad signatures and stale timestamps', async () => {
			expect(
				(await webhook(subscriptionEvent('subscription.active'), { secret: 'wrong' }))
					.statusCode,
			).toBe(401);
			const stale = await webhook(subscriptionEvent('subscription.active'), {
				timestamp: Math.floor(Date.now() / 1000) - 3600,
			});
			expect(stale.json().error.details.reason).toBe('timestamp');
			expect((await entitlements(alice.browser)).plan_slug).toBe('free');
		});

		it('activates Supporter from a signed subscription webhook, once', async () => {
			const first = await webhook(subscriptionEvent('subscription.active'), {
				id: 'evt_active',
			});
			expect(first.statusCode).toBe(200);
			expect(first.json()).toEqual({ received: true });
			expect(await entitlements(alice.browser)).toMatchObject({
				plan_slug: 'supporter',
				source: 'subscription',
				pouch_limit: 3,
			});
			expect(
				(await webhook(subscriptionEvent('subscription.active'), { id: 'evt_active' }))
					.statusCode,
			).toBe(200);
			const billing = await alice.browser.get('/v1/billing');
			expect(billing.body.data.subscriptions).toEqual([
				expect.objectContaining({ status: 'active', plan_slug: 'supporter' }),
			]);
		});

		it('keeps Supporter until the period ends after a cancel-at-period-end', async () => {
			await webhook(
				subscriptionEvent('subscription.canceled', {
					cancel_at_period_end: true,
					modified_at: new Date(Date.now() - 60_000).toISOString(),
				}),
			);
			expect((await entitlements(alice.browser)).plan_slug).toBe('supporter');
			const billing = await alice.browser.get('/v1/billing');
			expect(billing.body.data.subscriptions[0].cancel_at_period_end).toBe(true);
		});

		it('ignores a webhook delivered out of order', async () => {
			await webhook(
				subscriptionEvent('subscription.updated', {
					status: 'past_due',
					modified_at: new Date(Date.now() - 30_000).toISOString(),
				}),
			);
			await webhook(
				subscriptionEvent('subscription.updated', {
					status: 'active',
					modified_at: new Date(Date.now() - 45_000).toISOString(),
				}),
			);
			const { rows } = await h.owner.query(
				`SELECT status FROM subscriptions WHERE external_subscription_id = 'sub_1'`,
			);
			expect(rows[0].status).toBe('past_due');
		});

		it('falls back to Free when the subscription is revoked, without deleting anything', async () => {
			// Polar's revoke: status `canceled`, `ended_at` now, period end still in the future.
			await webhook(
				subscriptionEvent('subscription.revoked', {
					status: 'canceled',
					ended_at: new Date(Date.now() - 1000).toISOString(),
					modified_at: new Date(Date.now() - 1000).toISOString(),
				}),
			);
			expect((await entitlements(alice.browser)).plan_slug).toBe('free');
			expect((await alice.browser.get('/v1/pouches')).body.data.pouches).toHaveLength(1);
		});

		it('reconcile pulls the provider state for open subscriptions', async () => {
			await h.owner.query(`UPDATE subscriptions SET status = 'active'`);
			remoteSubscription = subscriptionEvent('x', {
				status: 'canceled',
				current_period_end: new Date(Date.now() - 1000).toISOString(),
			}).data;
			const { reconcileSubscriptions } =
				await import('../../src/modules/billing/billing.service');
			expect(await reconcileSubscriptions(h.deps)).toBe(1);
			const { rows } = await h.owner.query(
				`SELECT status FROM subscriptions WHERE external_subscription_id = 'sub_1'`,
			);
			expect(rows[0].status).toBe('canceled');
			// Finished canceled subscriptions are not polled again.
			expect(await reconcileSubscriptions(h.deps)).toBe(0);
		});
	});

	describe('admin dashboard', () => {
		it('is closed to non-admins', async () => {
			expect((await alice.browser.get('/v1/admin/overview')).status).toBe(403);
		});

		it('bootstraps the admin role from ADMIN_EMAILS and shows the overview', async () => {
			const overview = await admin.get('/v1/admin/overview');
			expect(overview.status).toBe(200);
			expect(overview.body.data.users).toBeGreaterThanOrEqual(2);
		});

		it('searches users and shows metadata, never content', async () => {
			await authorizeCli(h, alice);
			const list = await admin.get('/v1/admin/users?q=alice');
			expect(list.body.data.items).toEqual([
				expect.objectContaining({
					email: 'alice@skillpouch.test',
					device_count: 1,
					pouch_count: 1,
				}),
			]);
			const detail = await admin.get(`/v1/admin/users/${alice.browser.userId}`);
			expect(detail.body.data.pouches).toEqual([
				expect.objectContaining({ id: alice.pouchId, state: 'active' }),
			]);
			expect(JSON.stringify(detail.body.data)).not.toContain('envelope');
		});

		it('requires a reason and a fresh sign-in for mutations', async () => {
			const noReason = await admin.post(`/v1/admin/users/${alice.browser.userId}/grants`, {
				plan_slug: 'supporter',
			});
			expect(noReason.status).toBe(400);
			await h.owner.query(
				`UPDATE sessions SET step_up_at = now() - interval '1 hour' WHERE user_id = $1`,
				[admin.userId],
			);
			const stale = await admin.post(`/v1/admin/users/${alice.browser.userId}/grants`, {
				plan_slug: 'supporter',
				reason: 'beta tester',
			});
			expect(stale.body.error.code).toBe('step_up_required');
			await h.owner.query(`UPDATE sessions SET step_up_at = now() WHERE user_id = $1`, [
				admin.userId,
			]);
		});

		it('grants a plan, then revokes the grant', async () => {
			const grant = await admin.post(`/v1/admin/users/${alice.browser.userId}/grants`, {
				plan_slug: 'supporter',
				reason: 'beta tester',
			});
			expect(grant.status).toBe(200);
			expect(await entitlements(alice.browser)).toMatchObject({
				plan_slug: 'supporter',
				source: 'grant',
			});
			expect(
				(
					await admin.post(`/v1/admin/grants/${grant.body.data.id}/revoke`, {
						reason: 'beta over',
					})
				).status,
			).toBe(200);
			expect((await entitlements(alice.browser)).plan_slug).toBe('free');
		});

		it('sets and clears per-user overrides', async () => {
			const set = await admin.put(`/v1/admin/users/${alice.browser.userId}/override`, {
				pouch_limit: 5,
				storage_bytes: null,
				note: 'friend',
				reason: 'friend of the project',
			});
			expect(set.status).toBe(200);
			expect(await entitlements(alice.browser)).toMatchObject({
				pouch_limit: 5,
				source: 'override',
			});
			await admin.delete(`/v1/admin/users/${alice.browser.userId}/override`, {
				body: { reason: 'cleanup' },
			});
			expect((await entitlements(alice.browser)).pouch_limit).toBe(1);
		});

		it('suspends and unsuspends a user (web and CLI blocked meanwhile)', async () => {
			const cli = await authorizeCli(h, alice, 'suspend-test');
			expect(
				(
					await admin.post(`/v1/admin/users/${alice.browser.userId}/suspend`, {
						reason: 'abuse report',
					})
				).status,
			).toBe(200);
			expect((await cli.get('/v1/pouches')).status).toBe(403);
			expect((await alice.browser.get('/v1/pouches')).status).toBe(401);
			expect(
				(
					await admin.post(`/v1/admin/users/${alice.browser.userId}/unsuspend`, {
						reason: 'resolved',
					})
				).status,
			).toBe(200);
			expect((await cli.get('/v1/pouches')).status).toBe(200);
			alice.browser = await signIn(h, 'alice@skillpouch.test');
		});

		it('revokes all devices of a user', async () => {
			const response = await admin.post(
				`/v1/admin/users/${alice.browser.userId}/revoke-devices`,
				{ reason: 'lost laptop' },
			);
			expect(response.body.data.revoked).toBeGreaterThanOrEqual(1);
		});

		it('never demotes the last admin', async () => {
			const response = await admin.post(`/v1/admin/users/${admin.userId}/role`, {
				role: 'user',
				reason: 'testing',
			});
			expect(response.body.error.code).toBe('last_admin');
		});

		it('creates and edits plans; paid plans get a Polar product', async () => {
			const created = await admin.post('/v1/admin/plans', {
				slug: 'supporter-plus',
				name: 'Supporter+',
				price_cents: 1000,
				interval: 'month',
				pouch_limit: 10,
				storage_bytes: 10 * 1024 ** 3,
				reason: 'new tier',
			});
			expect(created.body.data).toMatchObject({
				slug: 'supporter-plus',
				polar_product_id: 'prod_new',
			});
			const edited = await admin.put(`/v1/admin/plans/${created.body.data.id}`, {
				name: 'Supporter+',
				price_cents: 1000,
				interval: 'month',
				pouch_limit: 12,
				storage_bytes: 10 * 1024 ** 3,
				reason: 'more pouches',
			});
			expect(edited.body.data.pouch_limit).toBe(12);
			const free = (await admin.get('/v1/admin/plans')).body.data.plans.find(
				(plan: { slug: string }) => plan.slug === 'free',
			);
			const breakFree = await admin.put(`/v1/admin/plans/${free.id}`, {
				...free,
				price_cents: 100,
				interval: 'month',
				reason: 'nope',
			});
			expect(breakFree.status).toBe(400);
		});

		it('toggles the maintenance write pause', async () => {
			expect(
				(
					await admin.put('/v1/admin/system/write-pause', {
						enabled: true,
						reason: 'db switchover',
					})
				).body.data.write_pause,
			).toBe(true);
			expect((await admin.get('/v1/admin/system')).body.data.write_pause).toBe(true);
			await h.owner.query(
				`UPDATE system_settings SET value = '{"enabled": false}' WHERE key = 'maintenance_write_pause'`,
			);
			h.deps.settings.invalidate();
		});

		it('records every admin action in the audit log', async () => {
			const audit = await admin.get('/v1/admin/audit?limit=100');
			const actions = audit.body.data.items.map((entry: { action: string }) => entry.action);
			expect(actions).toEqual(
				expect.arrayContaining([
					'admin.plan_granted',
					'admin.override_set',
					'admin.user_suspended',
					'admin.devices_revoked',
					'admin.plan_created',
				]),
			);
		});
	});

	describe('plan sync', () => {
		it('takes plan names from the provider and creates tagged plans', async () => {
			const before = await h.owner.query(
				`SELECT entitlements FROM storage_accounts WHERE id = $1`,
				[alice.accountId],
			);
			const plan = await h.owner.query(
				`SELECT name, description FROM plans WHERE slug = 'supporter'`,
			);
			await h.owner.query(
				`UPDATE storage_accounts SET entitlements = jsonb_set(entitlements, '{plan_slug}', '"supporter"') WHERE id = $1`,
				[alice.accountId],
			);
			remoteProducts = [
				polarProduct(PRODUCT, 'Supporter Gold', { plan: 'supporter' }),
				polarProduct(
					'prod_team',
					'Team',
					{ plan: 'team', pouch_limit: 10, storage_bytes: '5368709120' },
					1000,
				),
				polarProduct('prod_untagged', 'Sticker pack', {}),
			];
			try {
				const result = await syncPlansFromProvider(h.deps);
				expect(result).toMatchObject({
					created: ['team'],
					updated: ['supporter'],
				});

				const plans = (await alice.browser.get('/v1/plans')).body.data.plans as {
					slug: string;
					name: string;
					price_cents: number;
					pouch_limit: number;
				}[];
				expect(plans.find((plan) => plan.slug === 'supporter')?.name).toBe(
					'Supporter Gold',
				);
				expect(plans.find((plan) => plan.slug === 'team')).toMatchObject({
					name: 'Team',
					price_cents: 1000,
					pouch_limit: 10,
				});
				expect(plans.some((plan) => plan.name === 'Sticker pack')).toBe(false);
				expect((await entitlements(alice.browser)).plan_name).toBe('Supporter Gold');

				expect(await syncPlansFromProvider(h.deps)).toMatchObject({
					created: [],
					linked: [],
					updated: [],
				});
			} finally {
				remoteProducts = [];
				await h.owner.query(
					`UPDATE plans SET name = $1, description = $2 WHERE slug = 'supporter'`,
					[plan.rows[0].name, plan.rows[0].description],
				);
				await h.owner.query(`DELETE FROM plans WHERE slug = 'team'`);
				await h.owner.query(`UPDATE storage_accounts SET entitlements = $2 WHERE id = $1`, [
					alice.accountId,
					before.rows[0].entitlements,
				]);
			}
		});
	});
});
