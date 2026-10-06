// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Two browsers of the same account stay in step through the event stream:
 * what one saves appears in the other without a reload, and a browser
 * revoked from the other is signed out on the spot.
 */
import {
	PASSWORD,
	createAccount,
	expect,
	newBrowser,
	openFirstPouch,
	signIn,
	test,
	unlock,
} from './fixtures';

test.describe('live updates', () => {
	test.slow();

	test('an item saved in one browser shows up in the other without a reload', async ({
		page,
		browser,
	}) => {
		const account = await createAccount(page);
		const second = await newBrowser(browser);
		await signIn(second, account.email);
		await unlock(second, PASSWORD);
		await openFirstPouch(second);
		await second
			.getByRole('navigation')
			.getByRole('link', { name: /^Skills/ })
			.first()
			.click();
		await expect(second.getByText('No skills yet')).toBeVisible();

		await openFirstPouch(page);
		await page
			.getByRole('navigation')
			.getByRole('link', { name: /^Skills/ })
			.first()
			.click();
		await page.getByRole('button', { name: 'Add skill' }).first().click();
		await page.getByRole('dialog').getByLabel('Item name').fill('live-skill');
		await page.getByRole('dialog').getByRole('button', { name: 'Add skill' }).click();
		await expect(page.getByText('Skill added')).toBeVisible();

		await expect(second.getByRole('row').filter({ hasText: 'live-skill' })).toBeVisible({
			timeout: 15_000,
		});
	});

	test('a browser revoked from another one is signed out immediately', async ({
		page,
		browser,
	}) => {
		const account = await createAccount(page);
		const second = await newBrowser(browser);
		await signIn(second, account.email);
		await unlock(second, PASSWORD);
		await expect(second.getByRole('heading', { name: 'Pouches' })).toBeVisible();

		await page.goto('/app/account/devices');
		const browsers = page.getByRole('region', { name: 'Browsers' });
		await expect(browsers.getByRole('listitem')).toHaveCount(2);
		await browsers
			.getByRole('listitem', { name: 'Browser', exact: true })
			.getByRole('button', { name: 'Revoke' })
			.click();
		await page
			.getByRole('dialog', { name: 'Revoke this browser?' })
			.getByRole('button', { name: 'Revoke' })
			.click();

		await expect(second).toHaveURL(/\/sign-in/, { timeout: 15_000 });
		await expect(
			second.getByText('This browser was removed from your account. Sign in again.'),
		).toBeVisible();
	});
});
