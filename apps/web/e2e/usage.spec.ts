// SPDX-License-Identifier: AGPL-3.0-only
/** Token usage: what a computer reports shows up summed on the Usage page. */
import { baseURL } from '../playwright.config';
import { FakeCli } from './fake-cli';
import { createAccount, expect, test } from './fixtures';

const SOURCE = 'a'.repeat(32);

test.describe('token usage', () => {
	test('shows nothing until a computer reports, then the sums', async ({ page }) => {
		await createAccount(page);
		await page.goto('/account/usage');
		await expect(page.getByText('No token usage yet')).toBeVisible();

		await page.goto('/account/devices');
		await page.getByRole('button', { name: 'Connect CLI' }).first().click();
		const command = await page.getByTestId('connect-command').getAttribute('data-command');
		const token = command?.match(/sp_lt_[A-Za-z0-9_-]{32}/)?.[0];
		expect(token).toBeTruthy();
		const cli = await FakeCli.create(baseURL, 'usage-pc');
		await cli.login(token);

		const today = new Date().toISOString().slice(0, 10);
		const row = { day: today, input: 1_000, output: 200, cache_read: 0, cache_write: 0 };
		const report = (rows: object[]) => cli.call('PUT', `/v1/usage/sources/${SOURCE}`, { rows });
		expect(
			(
				await report([
					{ ...row, assistant: 'claude-code', model: 'claude-opus' },
					{ ...row, assistant: 'codex', model: 'gpt-5', input: 300, output: 0 },
				])
			).status,
		).toBe(200);
		// Sending the same day again replaces it instead of adding to it.
		await report([{ ...row, assistant: 'claude-code', model: 'claude-opus' }]);

		await page.goto('/account/usage');
		const totals = page.getByRole('region', { name: 'Totals' });
		await expect(totals).toContainText('Today');
		await expect(totals).toContainText('1.5K');
		const models = page.getByRole('region', { name: 'This month by model' });
		await expect(models).toContainText('claude-opus');
		await expect(models).toContainText('1.2K');
		const assistants = page.getByRole('region', { name: 'This month by assistant' });
		await expect(assistants).toContainText('Claude Code');
		await expect(assistants).toContainText('Codex');
		const grid = page.getByRole('region', { name: 'Tokens per day' });
		await expect(grid.locator('[data-level="4"]')).toHaveCount(1);
	});
});
