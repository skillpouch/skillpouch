// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Computers: connecting the CLI (one-time token, or the authorize link with a
 * confirm code), what the Devices page shows, renaming and revoking.
 */
import type { Page } from '@playwright/test';
import { baseURL } from '../playwright.config';
import { FakeCli } from './fake-cli';
import { createAccount, expect, test } from './fixtures';

async function openConnectDialog(page: Page): Promise<string> {
	await page.goto('/app/account/devices');
	await page.getByRole('button', { name: 'Connect CLI' }).first().click();
	const command = page.getByTestId('connect-command');
	await expect(command).toContainText('npx skillpouch login sp_lt_');
	const token = (await command.textContent())!.match(/sp_lt_[A-Za-z0-9_-]{32}/)?.[0];
	expect(token).toBeTruthy();
	return token!;
}

test.describe('connect a computer', () => {
	test('a one-time token connects the CLI without any extra click', async ({ page }) => {
		await createAccount(page);
		const token = await openConnectDialog(page);
		const cli = await FakeCli.create(baseURL, 'work-laptop');
		const login = await cli.login(token);

		await expect(page.getByTestId('connected-device')).toContainText('work-laptop');
		expect(login.welcome.member_id).toBe(login.memberId);
		expect(login.welcome.genesis_hash).toMatch(/^[A-Za-z0-9_-]+$/);

		// The token was used up: a second computer cannot reuse it.
		const thief = await FakeCli.create(baseURL, 'thief');
		await expect(thief.login(token)).rejects.toThrow(/connect_token_invalid/);
	});

	test('the Devices page lists the computer with its detected assistants', async ({ page }) => {
		await createAccount(page);
		const token = await openConnectDialog(page);
		await (await FakeCli.create(baseURL, 'desk-pc')).login(token);
		await page.keyboard.press('Escape');
		await page.reload();
		const computers = page.getByRole('region', { name: 'Computers' });
		const row = computers.getByRole('listitem', { name: 'desk-pc' });
		await expect(row).toContainText('Linux');
		await expect(row).toContainText('Claude Code');
		await expect(row).toContainText('OpenCode');
	});

	test('the authorize link shows the same confirm code the CLI prints', async ({ page }) => {
		await createAccount(page);
		const cli = await FakeCli.create(baseURL, 'linked-pc');
		let request!: { authorizeUrl: string; confirmCode: string };
		const requested = new Promise<void>((done) => {
			void cli
				.login(undefined, (value) => {
					request = value;
					done();
				})
				.catch(() => undefined);
		});
		await requested;
		await page.goto(request.authorizeUrl);
		await expect(page.getByRole('heading', { name: 'Authorize this computer?' })).toBeVisible();
		await expect(page.getByTestId('confirm-code')).toHaveText(request.confirmCode);
		await page.getByRole('button', { name: 'Authorize' }).click();
		await expect(page.getByRole('heading', { name: 'linked-pc is connected' })).toBeVisible();
	});

	test('denying the authorize link stops the CLI', async ({ page }) => {
		await createAccount(page);
		const cli = await FakeCli.create(baseURL, 'unknown-pc');
		let authorizeUrl = '';
		let failure: Promise<unknown> = Promise.resolve();
		await new Promise<void>((done) => {
			failure = cli
				.login(undefined, (value) => {
					authorizeUrl = value.authorizeUrl;
					done();
				})
				.then(
					() => 'approved',
					(error: Error) => error.message,
				);
		});
		await page.goto(authorizeUrl);
		await page.getByRole('button', { name: 'Deny' }).click();
		await expect(page.getByRole('heading', { name: 'Request denied' })).toBeVisible();
		expect(await failure).toMatch(/cli_auth_denied/);
	});
});

test.describe('manage computers', () => {
	test('renames a computer', async ({ page }) => {
		await createAccount(page);
		await (await FakeCli.create(baseURL, 'old-name')).login(await openConnectDialog(page));
		await page.reload();
		await page.getByRole('button', { name: 'Actions for old-name' }).click();
		await page.getByRole('menuitem', { name: 'Rename' }).click();
		const dialog = page.getByRole('dialog', { name: 'Rename device' });
		await dialog.getByLabel('Device name').fill('new-name');
		await dialog.getByRole('button', { name: /rename|save/i }).click();
		await expect(page.getByRole('listitem', { name: 'new-name' })).toBeVisible();
	});

	test('revoking a computer cuts it off immediately', async ({ page }) => {
		await createAccount(page);
		const cli = await FakeCli.create(baseURL, 'lost-laptop');
		await cli.login(await openConnectDialog(page));
		expect((await cli.call('GET', '/v1/me')).status).toBe(200);

		await page.reload();
		await page.getByRole('button', { name: 'Actions for lost-laptop' }).click();
		await page.getByRole('menuitem', { name: 'Revoke' }).click();
		await page
			.getByRole('dialog', { name: 'Revoke lost-laptop?' })
			.getByRole('button', { name: 'Revoke device' })
			.click();

		await expect(page.getByRole('button', { name: /Revoked \(1\)/ })).toBeVisible();
		const after = await cli.call('GET', '/v1/me');
		expect(after.status).toBe(401);
		expect(after.error?.code).toBe('device_revoked');
	});
});
