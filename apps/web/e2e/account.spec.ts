// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Account settings: changing the master password and the Recovery Key,
 * deleting the account (and changing your mind), billing, and isolation
 * between accounts.
 */
import {
	PASSWORD,
	createAccount,
	expect,
	newBrowser,
	openFirstPouch,
	setPlan,
	signIn,
	test,
	unlock,
} from './fixtures';

const NEW_PASSWORD = 'a completely different passphrase 7';

test.describe('security', () => {
	test.slow();

	test('a changed master password unlocks new browsers; the old one no longer does', async ({
		page,
		browser,
	}) => {
		const account = await createAccount(page);
		await page.goto('/account/security');
		await page.getByRole('button', { name: 'Change', exact: true }).click();
		const dialog = page.getByRole('dialog', { name: 'Change master password' });
		await dialog.getByLabel('Master password').fill(NEW_PASSWORD);
		await dialog.getByLabel('Confirm password').fill(NEW_PASSWORD);
		await dialog.getByRole('button', { name: 'Change password' }).click();
		await expect(page.getByText('Master password changed')).toBeVisible();

		const other = await newBrowser(browser);
		await signIn(other, account.email);
		await unlock(other, PASSWORD);
		await expect(other.getByText('Wrong master password.')).toBeVisible();
		await other.getByLabel('Master password').fill(NEW_PASSWORD);
		await other.getByRole('button', { name: 'Unlock', exact: true }).click();
		await expect(other.getByRole('heading', { name: 'Pouches' })).toBeVisible();
	});

	test('a new Recovery Key replaces the old one', async ({ page, browser }) => {
		const account = await createAccount(page);
		await page.goto('/account/security');
		await page.getByRole('button', { name: 'Create new key' }).click();
		const dialog = page.getByRole('dialog', { name: 'Create a new Recovery Key' });
		const replace = dialog.getByRole('button', { name: 'Replace Recovery Key' });
		await expect(replace).toBeDisabled();
		const words = await dialog
			.getByTestId('recovery-key')
			.locator('li > span:last-child')
			.allTextContents();
		expect(words).toHaveLength(12);
		await dialog.getByRole('checkbox', { name: 'I saved my new Recovery Key' }).click();
		await replace.click();
		await expect(page.getByText('New Recovery Key saved')).toBeVisible();

		const other = await newBrowser(browser);
		await signIn(other, account.email);
		await unlock(other, account.recoveryKey, 'recovery');
		await expect(other.getByRole('alert').first()).toBeVisible();
		await other.getByLabel('Recovery Key').fill(words.join(' '));
		await other.getByRole('button', { name: 'Unlock', exact: true }).click();
		await expect(other.getByRole('heading', { name: 'Pouches' })).toBeVisible();
	});
});

test.describe('layout and controls', () => {
	test('moving between account pages keeps the sidebar and top bar on screen', async ({
		page,
	}) => {
		await createAccount(page);
		await page.goto('/account');
		const sidebar = page.getByRole('navigation', { name: 'Main' });
		await expect(sidebar).toBeVisible();
		for (const [link, heading] of [
			['Devices', 'Devices'],
			['Security', 'Security'],
			['Billing', 'Billing'],
			['Profile', 'Profile'],
		] as const) {
			await sidebar.getByRole('link', { name: link }).click();
			await expect(page.getByRole('heading', { level: 1, name: heading })).toBeVisible();
			await expect(sidebar).toBeVisible();
			await expect(page.getByRole('button', { name: 'Account menu' })).toBeVisible();
		}
	});

	test('buttons show a pointer cursor', async ({ page }) => {
		await createAccount(page);
		await page.goto('/account/security');
		const cursor = await page
			.getByRole('button', { name: 'Change', exact: true })
			.evaluate((element) => getComputedStyle(element).cursor);
		expect(cursor).toBe('pointer');
	});

	test('the trust window changes at once and stays changed', async ({ page }) => {
		await createAccount(page);
		await page.goto('/account/security');
		const group = page.getByRole('radiogroup', { name: 'Trust window' });
		const sixty = group.getByRole('radio', { name: '60d' });
		await sixty.click();
		await expect(sixty).toHaveAttribute('aria-checked', 'true', { timeout: 200 });
		await expect(page.getByText('Saved')).toBeVisible();
		await page.reload();
		await expect(
			page
				.getByRole('radiogroup', { name: 'Trust window' })
				.getByRole('radio', { name: '60d' }),
		).toHaveAttribute('aria-checked', 'true');
	});
});

test.describe('account', () => {
	test('deleting the account can be cancelled within the undo window', async ({ page }) => {
		await createAccount(page);
		await page.goto('/account');
		await page.getByRole('button', { name: 'Delete account' }).click();
		await page
			.getByRole('dialog', { name: 'Delete your account?' })
			.getByRole('button', { name: 'Delete account' })
			.click();
		await expect(page.getByText(/Your account will be deleted on/)).toBeVisible();
		await expect(page.getByRole('button', { name: 'Deletion scheduled' })).toBeDisabled();

		await page.getByRole('button', { name: 'Cancel deletion' }).click();
		await expect(page.getByText('Account deletion cancelled')).toBeVisible();
		await expect(page.getByText(/Your account will be deleted on/)).toHaveCount(0);
	});

	test('billing shows the current plan and usage, and follows plan changes', async ({ page }) => {
		await createAccount(page);
		await page.goto('/account/billing');
		const plans = page.getByRole('region', { name: 'Plans' });
		await expect(plans.getByRole('article', { name: 'Free' })).toContainText('Current plan');
		await expect(plans.getByRole('article', { name: 'Supporter' })).toContainText('3 pouches');
		await expect(page.getByRole('region', { name: 'Usage' })).toContainText('Storage');

		await setPlan(page, 'supporter');
		await expect(page.getByText('You’re a Supporter')).toBeVisible();
		await expect(page.getByText('Granted by the SkillPouch team.')).toBeVisible();
		// The plan name shimmers all the time, not only on hover.
		await page.mouse.move(0, 0);
		const pillText = page.locator('.plan-badge .plan-text').first();
		await expect(pillText).toHaveCSS('animation-name', 'plan-shimmer');

		// The top-bar pill shows only the mark until hovered.
		const pill = page.getByRole('link', { name: 'Supporter plan, open billing' });
		await expect.poll(async () => (await pill.boundingBox())?.width).toBeLessThan(30);
		await pill.hover();
		await expect.poll(async () => (await pill.boundingBox())?.width).toBeGreaterThan(60);
	});

	test('a hidden plan given by an admin stays off the plans and locks paying', async ({
		page,
	}) => {
		await createAccount(page);
		await page.goto('/account/billing');
		const plans = page.getByRole('region', { name: 'Plans' });
		await expect(plans.getByRole('article', { name: 'Supporter' })).toBeVisible();
		await expect(plans.getByRole('article', { name: 'Friends Pass' })).toHaveCount(0);

		await setPlan(page, 'friends-pass');
		await expect(page.getByText('You’re a Friends Pass')).toBeVisible();
		await expect(page.getByText('Thank you for being a friend of mine.')).toBeVisible();
		await expect(page.getByText(/Friends don’t pay here/)).toBeVisible();
		await expect(plans.getByRole('article', { name: 'Friends Pass' })).toHaveCount(0);
		const supporter = plans.getByRole('article', { name: 'Supporter' });
		await expect(supporter).toHaveAttribute('aria-disabled', 'true');
		await expect(supporter.getByRole('button')).toHaveCount(0);
		await expect(page.getByRole('button', { name: /subscription/ })).toHaveCount(0);
	});
});

test.describe('isolation', () => {
	test.slow();

	test('one account cannot open another account’s pouch', async ({ page, browser }) => {
		await createAccount(page);
		await openFirstPouch(page);
		const victimUrl = page.url();

		const attacker = await newBrowser(browser);
		await createAccount(attacker, 'attacker');
		await attacker.goto(victimUrl);
		await expect(attacker.getByRole('heading', { name: 'Nothing here' })).toBeVisible();
		await attacker.goto(`${victimUrl}/skills`);
		await expect(attacker.getByRole('heading', { name: 'Nothing here' })).toBeVisible();
	});
});
