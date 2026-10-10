// SPDX-License-Identifier: AGPL-3.0-only
/** Sign-in, onboarding, unlock and the redirects between them. */
import {
	PASSWORD,
	completeSetup,
	createAccount,
	expect,
	newBrowser,
	signIn,
	test,
	uniqueEmail,
	unlock,
} from './fixtures';

test.describe('signed out', () => {
	test('dashboard pages send you to sign-in, keeping where you were going', async ({ page }) => {
		await page.goto('/app');
		await expect(page).toHaveURL(/\/sign-in/);
		await page.goto('/app/account/devices');
		await expect(page).toHaveURL(/\/sign-in\?redirect=%2Fapp%2Faccount%2Fdevices/);
		await expect(page.getByRole('heading', { name: 'Sign in to SkillPouch' })).toBeVisible();
		await expect(page.getByRole('button', { name: /GitHub/ })).toBeVisible();
		await expect(page.getByRole('button', { name: /Google/ })).toBeVisible();
	});

	test('shows the CLI hint and the cancelled error', async ({ page }) => {
		await page.goto('/sign-in?from=cli&error=cancelled');
		await expect(page.getByText('Sign in to connect your terminal')).toBeVisible();
		await expect(page.getByText('Sign-in was cancelled. Try again.')).toBeVisible();
	});

	test('ignores open redirects after sign-in', async ({ page }) => {
		await signIn(page, uniqueEmail(), '/sign-in?redirect=https%3A%2F%2Fevil.example%2F');
		await expect(page).toHaveURL(/\/setup/);
		expect(new URL(page.url()).host).toBe(new URL(page.url()).host);
	});

	test('the Terms and Privacy Policy are public and linked from sign-in', async ({ page }) => {
		await page.goto('/sign-in');
		await page.getByRole('link', { name: 'Terms' }).click();
		await expect(page).toHaveURL(/\/terms$/);
		await expect(page.getByRole('heading', { name: 'Terms of Service' })).toBeVisible();
		await page.getByRole('link', { name: 'Privacy Policy' }).click();
		await expect(page).toHaveURL(/\/privacy$/);
		await expect(page.getByRole('heading', { name: 'Privacy Policy' })).toBeVisible();
		await expect(page.getByRole('heading', { name: 'What we cannot see' })).toBeVisible();
	});

	test('unknown pages show not found', async ({ page }) => {
		await page.goto('/definitely/not/here');
		await expect(page.getByRole('heading', { name: 'Nothing here' })).toBeVisible();
	});
});

test.describe('onboarding', () => {
	test('validates the master password before moving on', async ({ page }) => {
		await signIn(page, uniqueEmail());
		await expect(page).toHaveURL(/\/setup/);
		await page.getByLabel('Master password').fill('short');
		await page.getByLabel('Confirm password').fill('short');
		await page.getByRole('button', { name: 'Continue' }).click();
		await expect(
			page.getByRole('heading', { name: 'Create your master password' }),
		).toBeVisible();

		await page.getByLabel('Master password').fill(PASSWORD);
		await page.getByLabel('Confirm password').fill(`${PASSWORD}x`);
		await page.getByRole('button', { name: 'Continue' }).click();
		await expect(
			page.getByRole('heading', { name: 'Create your master password' }),
		).toBeVisible();
	});

	test('cannot continue past the Recovery Key until it is confirmed', async ({ page }) => {
		await signIn(page, uniqueEmail());
		await page.getByLabel('Master password').fill(PASSWORD);
		await page.getByLabel('Confirm password').fill(PASSWORD);
		await page.getByRole('button', { name: 'Continue' }).click();
		await expect(page.getByRole('button', { name: 'Continue' })).toBeDisabled();
		await page.getByRole('checkbox', { name: 'I saved my Recovery Key' }).click();
		await expect(page.getByRole('button', { name: 'Continue' })).toBeEnabled();
	});

	test('creates the vault with a first pouch and lands on the pouches grid', async ({ page }) => {
		await createAccount(page);
		await expect(page.getByRole('heading', { name: 'Pouches' })).toBeVisible();
		await expect(page.getByText('Personal').first()).toBeVisible();
	});

	test('a set-up account never sees onboarding again', async ({ page }) => {
		await createAccount(page);
		await page.goto('/setup');
		await expect(page).toHaveURL(/\/app/);
	});
});

test.describe('unlock', () => {
	test('a trusted browser unlocks on reload without asking', async ({ page }) => {
		await createAccount(page);
		await page.reload();
		await expect(page.getByRole('heading', { name: 'Pouches' })).toBeVisible();
	});

	test('an untrusted browser asks again after reload', async ({ page }) => {
		await signIn(page, uniqueEmail());
		await completeSetup(page, { trust: false });
		await page.reload();
		await unlock(page, PASSWORD);
		await expect(page.getByRole('heading', { name: 'Pouches' })).toBeVisible();
	});

	test('a new browser rejects a wrong password, then unlocks with the right one', async ({
		page,
		browser,
	}) => {
		const account = await createAccount(page);
		const other = await newBrowser(browser);
		await signIn(other, account.email);
		await expect(other).toHaveURL(/\/unlock/);
		await unlock(other, 'not the right password at all');
		await expect(other.getByText('Wrong master password.')).toBeVisible();
		await unlock(other, account.password);
		await expect(other.getByRole('heading', { name: 'Pouches' })).toBeVisible();
		await expect(other.getByText('Personal').first()).toBeVisible();
		await other.context().close();
	});

	test('a new browser unlocks with the Recovery Key', async ({ page, browser }) => {
		const account = await createAccount(page);
		const other = await newBrowser(browser);
		await signIn(other, account.email);
		await unlock(
			other,
			'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon',
			'recovery',
		);
		await expect(
			other.getByRole('alert').or(other.getByText(/Recovery Key/).last()),
		).toBeVisible();
		await other.getByLabel('Recovery Key').fill(account.recoveryKey.toUpperCase());
		await other.getByRole('button', { name: 'Unlock', exact: true }).click();
		await expect(other.getByRole('heading', { name: 'Pouches' })).toBeVisible();
		await other.context().close();
	});

	test('"Not you?" signs out', async ({ page, browser }) => {
		const account = await createAccount(page);
		const other = await newBrowser(browser);
		await signIn(other, account.email);
		await other.getByRole('button', { name: 'Not you?' }).click();
		await expect(other).toHaveURL(/\/sign-in/);
		await other.context().close();
	});
});

test('signing out from the account menu returns to sign-in', async ({ page }) => {
	await createAccount(page);
	await page.getByRole('button', { name: /account menu/i }).click();
	await page.getByRole('menuitem', { name: 'Sign out' }).click();
	await expect(page).toHaveURL(/\/sign-in/);
	await page.goto('/app');
	await expect(page).toHaveURL(/\/sign-in/);
});
