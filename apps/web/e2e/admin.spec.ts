// SPDX-License-Identifier: AGPL-3.0-only
/** The admin dashboard: hidden from everyone else, and managing an account from it. */
import { completeSetup, createAccount, expect, newBrowser, signIn, test } from './fixtures';

const ADMIN = 'e2e-admin@skillpouch.test';

test.describe('admin dashboard', () => {
	test.slow();

	test('ordinary users get "not found" and no Admin menu item', async ({ page }) => {
		await createAccount(page, 'not-admin');
		await page.getByRole('button', { name: 'Account menu' }).click();
		await expect(page.getByRole('menuitem', { name: 'Admin dashboard' })).toHaveCount(0);
		await page.keyboard.press('Escape');
		await page.goto('/admin');
		await expect(page.getByRole('heading', { name: 'Nothing here' })).toBeVisible();
		await expect(page.getByRole('navigation', { name: 'Main' })).toHaveCount(0);
	});

	test('an admin sees the numbers and gives a plan with a reason', async ({ page, browser }) => {
		// Someone to manage.
		const other = await newBrowser(browser);
		const customer = await createAccount(other, 'customer');
		await other.context().close();

		await signIn(page, ADMIN);
		await completeSetup(page);
		await page.getByRole('button', { name: 'Account menu' }).click();
		await page.getByRole('menuitem', { name: 'Admin dashboard' }).click();
		await expect(page).toHaveURL(/\/admin$/);
		await expect(page.getByRole('heading', { name: 'Overview' })).toBeVisible();
		await expect(page.getByRole('group', { name: 'New users' })).toBeVisible();

		await page.getByRole('link', { name: 'Users', exact: true }).click();
		await page.getByRole('textbox', { name: 'Search users' }).fill(customer.email);
		await page.getByRole('button', { name: customer.email }).click();
		await expect(page.getByRole('heading', { name: customer.email })).toBeVisible();

		await page.getByRole('button', { name: 'Give a plan' }).click();
		const dialog = page.getByRole('dialog');
		const confirm = dialog.getByRole('button', { name: 'Give plan' });
		// The reason is optional, but kept when given.
		await expect(confirm).toBeEnabled();
		await dialog.getByLabel('Reason').fill('beta tester');
		await confirm.click();
		await expect(dialog).toBeHidden();
		await expect(page.getByRole('button', { name: 'Take back' })).toBeVisible();

		await page.getByRole('link', { name: 'Audit log' }).click();
		await expect(page.getByRole('cell', { name: 'admin.plan_granted' })).toBeVisible();
		await expect(page.getByText('“beta tester”')).toBeVisible();
	});
});
