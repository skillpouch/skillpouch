// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The admin dashboard's earnings and analytics: charges copied from Polar
 * (sync job, order webhooks, the Sync button), the numbers built from them,
 * and what keeps the dashboard admin-only.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { applyPendingBillingEvents } from '../../src/modules/billing/billing.service';
import { PolarProvider, signStandardWebhook } from '../../src/modules/billing/polar';
import { signIn, type BrowserClient } from '../helpers/clients';
import { setupAccount, type Account } from '../helpers/flows';
import { createHarness, type Harness } from '../helpers/harness';

const WEBHOOK_SECRET = 'polar-admin-webhook-secret';
const DAY = 86_400_000;

describe('admin dashboard', () => {
	let h: Harness;
	let alice: Account;
	let admin: BrowserClient;
	let orders: Record<string, unknown>[] = [];
	let ordersDown = false;

	const order = (id: string, overrides: Record<string, unknown> = {}) => ({
		id,
		created_at: new Date(Date.now() - DAY).toISOString(),
		status: 'paid',
		total_amount: 500,
		net_amount: 450,
		tax_amount: 50,
		refunded_amount: 0,
		currency: 'usd',
		product_id: 'prod_supporter',
		customer: { external_id: alice.accountId },
		...overrides,
	});

	const fakePolar: typeof fetch = async (input) => {
		const url = String(input);
		if (url.includes('/v1/orders/?')) {
			if (ordersDown) return new Response('{}', { status: 503 });
			return new Response(JSON.stringify({ items: orders, pagination: { max_page: 1 } }), {
				status: 200,
				headers: { 'content-type': 'application/json' },
			});
		}
		return new Response('{}', { status: 404 });
	};

	async function webhook(payload: unknown) {
		const body = JSON.stringify(payload);
		const id = `evt_${Math.random().toString(36).slice(2)}`;
		const timestamp = Math.floor(Date.now() / 1000);
		return h.app.inject({
			method: 'POST',
			url: '/v1/billing/webhooks/polar',
			headers: {
				'content-type': 'application/json',
				'webhook-id': id,
				'webhook-timestamp': String(timestamp),
				'webhook-signature': `v1,${signStandardWebhook(WEBHOOK_SECRET, id, timestamp, body)}`,
			},
			payload: body,
		});
	}

	const analytics = async (days = 30) =>
		(await admin.get(`/v1/admin/analytics?days=${days}`)).body.data;

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
						sleep: async () => {},
					});
				},
			},
		);
		await h.owner.query(
			`UPDATE plans SET polar_product_id = 'prod_supporter' WHERE slug = 'supporter'`,
		);
		alice = await setupAccount(h, 'alice-admin@skillpouch.test');
		admin = await signIn(h, 'admin@skillpouch.test');
	});
	afterAll(async () => {
		await h.close();
	});

	it('is for admins only, and never cached', async () => {
		for (const path of ['/v1/admin/analytics', '/v1/admin/payments', '/v1/admin/overview']) {
			const refused = await alice.browser.get(path);
			expect(refused.status).toBe(403);
		}
		expect((await alice.browser.post('/v1/admin/payments/sync')).status).toBe(403);
		const allowed = await admin.get('/v1/admin/analytics');
		expect(allowed.status).toBe(200);
		expect(allowed.headers['cache-control']).toBe('no-store');
	});

	it('copies charges from Polar and counts what the business keeps', async () => {
		orders = [
			order('ord_a'),
			order('ord_b', { created_at: new Date(Date.now() - 3 * DAY).toISOString() }),
			order('ord_refunded', { status: 'refunded', refunded_amount: 500 }),
			order('ord_pending', { status: 'pending' }),
			order('ord_eur', { currency: 'eur', total_amount: 900, net_amount: 900 }),
			order('ord_stranger', { customer: { external_id: 'not-one-of-ours' } }),
		];
		const synced = await admin.post('/v1/admin/payments/sync');
		expect(synced.status).toBe(200);
		expect(synced.body.data.synced).toBe(6);

		const list = (await admin.get('/v1/admin/payments')).body.data.items;
		expect(list).toHaveLength(6);
		const mine = list.find((payment: { id: string }) => payment.id === 'ord_a');
		expect(mine).toMatchObject({
			email: 'alice-admin@skillpouch.test',
			plan_slug: 'supporter',
			net_cents: 450,
			tax_cents: 50,
		});
		expect(list.find((p: { id: string }) => p.id === 'ord_stranger').email).toBeNull();

		const numbers = await analytics();
		expect(numbers.currency).toBe('usd');
		expect(numbers.revenue.other_currencies).toEqual(['eur']);
		// Two paid (450 each) + the stranger's (450); the refunded one keeps nothing.
		expect(numbers.revenue.earned_cents).toBe(1350);
		expect(numbers.revenue.refunded_cents).toBe(500);
		expect(numbers.revenue.payments).toBe(4);
		expect(numbers.series).toHaveLength(30);
		expect(numbers.series.at(-1).day).toBe(new Date().toISOString().slice(0, 10));
		const total = numbers.series.reduce(
			(sum: number, day: { earned_cents: number }) => sum + day.earned_cents,
			0,
		);
		expect(total).toBe(1350);

		const audit = (await admin.get('/v1/admin/audit?limit=5')).body.data.items;
		expect(audit[0].action).toBe('admin.payments_synced');
	});

	it('picks up refunds of older charges on the next sync', async () => {
		orders = [order('ord_a', { status: 'partially_refunded', refunded_amount: 250 })];
		await admin.post('/v1/admin/payments/sync');
		const numbers = await analytics();
		// 450 − half of it, + ord_b 450 + the stranger's 450.
		expect(numbers.revenue.earned_cents).toBe(225 + 450 + 450);
	});

	it('syncs when Polar sends an order webhook, and retries when Polar is down', async () => {
		orders = [order('ord_new', { created_at: new Date().toISOString() })];
		ordersDown = true;
		expect((await webhook({ type: 'order.paid', data: orders[0] })).statusCode).toBe(200);
		const missing = (await admin.get('/v1/admin/payments')).body.data.items;
		expect(missing.some((p: { id: string }) => p.id === 'ord_new')).toBe(false);
		ordersDown = false;
		await applyPendingBillingEvents(h.deps);
		const list = (await admin.get('/v1/admin/payments')).body.data.items;
		expect(list[0].id).toBe('ord_new');
	});

	it('sums growth, devices, plans and token usage', async () => {
		const today = new Date().toISOString().slice(0, 10);
		await h.owner.query(
			`INSERT INTO token_usage (storage_account_id, source_id, day, assistant, model,
				input_tokens, output_tokens, cache_read_tokens, cache_write_tokens)
			VALUES ($1, 'src', $2, 'claude-code', 'claude-opus', 1000, 200, 3000, 0),
				($1, 'src', $2, 'codex', 'gpt-5', 500, 100, 0, 0)`,
			[alice.accountId, today],
		);
		const numbers = await analytics(7);
		expect(numbers.series).toHaveLength(7);
		expect(numbers.tokens.total).toBe(4800);
		expect(numbers.tokens.assistants[0]).toEqual({ name: 'claude-code', tokens: 4200 });
		expect(numbers.series.at(-1).tokens).toBe(4800);
		expect(numbers.users.total).toBeGreaterThanOrEqual(2);
		expect(numbers.users.new).toBeGreaterThanOrEqual(2);
		expect(
			numbers.plans.reduce((sum: number, p: { accounts: number }) => sum + p.accounts, 0),
		).toBeGreaterThanOrEqual(2);
		expect(numbers.storage.pouches).toBeGreaterThanOrEqual(1);
	});

	it('records which accounts an admin opened', async () => {
		await admin.get(`/v1/admin/users/${alice.browser.userId}`);
		const audit = (await admin.get('/v1/admin/audit?limit=5')).body.data.items;
		expect(audit[0]).toMatchObject({
			action: 'admin.user_viewed',
			target: alice.browser.userId,
		});
	});

	it('wants a recent sign-in before syncing', async () => {
		await h.owner.query(
			`UPDATE sessions SET step_up_at = now() - interval '1 hour' WHERE user_id = $1`,
			[admin.userId],
		);
		const stale = await admin.post('/v1/admin/payments/sync');
		expect(stale.body.error.code).toBe('step_up_required');
		await h.owner.query(`UPDATE sessions SET step_up_at = now() WHERE user_id = $1`, [
			admin.userId,
		]);
	});

	it('rejects a bad range or cursor', async () => {
		expect((await admin.get('/v1/admin/analytics?days=3')).status).toBe(400);
		expect((await admin.get('/v1/admin/payments?cursor=nope')).status).toBe(400);
	});
});
