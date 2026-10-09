// SPDX-License-Identifier: AGPL-3.0-only
/** Token usage: computers report their counts, the account reads them summed, never doubled. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { CliClient } from '../helpers/clients';
import { authorizeCli, setupAccount, type Account } from '../helpers/flows';
import { createHarness, type Harness } from '../helpers/harness';

const LAPTOP = 'a'.repeat(32);
const DESKTOP = 'b'.repeat(32);

const today = new Date().toISOString().slice(0, 10);
const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);

function row(day: string, input: number, model = 'claude-opus-5-5', assistant = 'claude-code') {
	return { day, assistant, model, input, output: 10, cache_read: 100, cache_write: 0 };
}

describe('token usage', () => {
	let h: Harness;
	let account: Account;
	let laptop: CliClient;
	let desktop: CliClient;

	const report = (cli: CliClient, source: string, rows: unknown[]) =>
		cli.request('PUT', `/v1/usage/sources/${source}`, { body: { rows } });
	const summary = async (client: { get: CliClient['get'] }) =>
		(await client.get('/v1/usage')).body.data;

	beforeAll(async () => {
		h = await createHarness();
		account = await setupAccount(h, 'usage@skillpouch.test');
		laptop = await authorizeCli(h, account, 'laptop');
		desktop = await authorizeCli(h, account, 'desktop');
	});
	afterAll(async () => {
		await h.close();
	});

	it('starts empty', async () => {
		expect(await summary(account.browser)).toEqual({
			days: [],
			all_time: { input: 0, output: 0, cache_read: 0, cache_write: 0 },
			updated_at: null,
		});
	});

	it('sums computers, and sending the same logs again changes nothing', async () => {
		expect(
			(await report(laptop, LAPTOP, [row(yesterday, 5), row(today, 7)])).body.data,
		).toEqual({
			stored: 2,
		});
		await report(laptop, LAPTOP, [row(yesterday, 5), row(today, 7)]);
		await report(desktop, DESKTOP, [row(today, 3)]);

		const usage = await summary(account.browser);
		expect(usage.days).toEqual([
			row(yesterday, 5),
			{ ...row(today, 10), output: 20, cache_read: 200 },
		]);
		expect(usage.all_time).toEqual({ input: 15, output: 30, cache_read: 300, cache_write: 0 });
		expect(usage.updated_at).not.toBeNull();
	});

	it('keeps the larger count when old logs were cleaned up, and grows with new ones', async () => {
		await report(laptop, LAPTOP, [row(today, 9)]);
		await report(laptop, LAPTOP, [row(yesterday, 1)]);
		const usage = await summary(laptop);
		expect(usage.days.map((d: { day: string; input: number }) => [d.day, d.input])).toEqual([
			[yesterday, 5],
			[today, 12],
		]);
	});

	it('a computer that logs in again reports under the same source, not on top of it', async () => {
		const again = await authorizeCli(h, account, 'laptop');
		await report(again, LAPTOP, [row(yesterday, 5), row(today, 9)]);
		expect((await summary(account.browser)).all_time.input).toBe(5 + 9 + 3);
	});

	it('keeps models and assistants apart', async () => {
		await report(desktop, DESKTOP, [row(today, 4, 'gpt-6', 'codex')]);
		const models = (await summary(account.browser)).days
			.filter((d: { day: string }) => d.day === today)
			.map((d: { assistant: string; model: string }) => `${d.assistant}/${d.model}`);
		expect(models).toEqual(['claude-code/claude-opus-5-5', 'codex/gpt-6']);
	});

	it('refuses bad reports', async () => {
		const future = new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10);
		expect((await report(laptop, LAPTOP, [row(future, 1)])).status).toBe(400);
		expect((await report(laptop, LAPTOP, [row(today, 1), row(today, 2)])).status).toBe(400);
		expect((await report(laptop, 'not-a-source', [row(today, 1)])).status).toBe(400);
		expect(
			(
				await account.browser.request('PUT', `/v1/usage/sources/${LAPTOP}`, {
					body: { rows: [] },
				})
			).status,
		).toBe(401);
	});

	it('is invisible to other accounts', async () => {
		const other = await setupAccount(h, 'usage-other@skillpouch.test');
		expect((await summary(other.browser)).days).toEqual([]);
	});
});
