// SPDX-License-Identifier: AGPL-3.0-only
/** The public landing page at `/`. */
import { createAccount, expect, test } from './fixtures';

test.describe('landing page', () => {
	test('is public and leads to sign-in', async ({ page }) => {
		await page.goto('/');
		await expect(
			page.getByRole('heading', {
				level: 1,
				name: 'Your AI coding setup, on every computer.',
			}),
		).toBeVisible();
		await expect(page.getByRole('button', { name: 'Copy npm i -g skillpouch' })).toBeVisible();
		await expect(
			page.getByRole('heading', { name: 'Free to use. Paid plans add room.' }),
		).toBeVisible();
		await expect(page.getByRole('heading', { name: 'Free', exact: true })).toBeVisible();

		await page
			.getByRole('navigation', { name: 'Main' })
			.getByRole('link', { name: 'Get started' })
			.click();
		await expect(page).toHaveURL(/\/sign-in$/);
	});

	test('answers questions and links the legal pages', async ({ page }) => {
		await page.goto('/');
		const faq = page.getByText('Can SkillPouch read what I sync?');
		await faq.click();
		await expect(page.getByText(/Files and item names are encrypted/).last()).toBeVisible();
		await page
			.getByRole('navigation', { name: 'Footer' })
			.getByRole('link', { name: 'Terms' })
			.click();
		await expect(page.getByRole('heading', { name: 'Terms of Service' })).toBeVisible();
	});

	test('signed-in visitors open the app from the nav', async ({ page }) => {
		await createAccount(page);
		await page.goto('/');
		const open = page.getByRole('navigation', { name: 'Main' }).getByRole('link', {
			name: 'Open SkillPouch',
		});
		await expect(open).toBeVisible();
		await open.click();
		await expect(page).toHaveURL(/\/app\/?$/);
	});
});

test('the landing page fits a phone @mobile', async ({ page }) => {
	await page.goto('/');
	await expect(page.getByRole('link', { name: 'Get started' }).first()).toBeVisible();
	const overflow = await page.evaluate(
		() => document.documentElement.scrollWidth - document.documentElement.clientWidth,
	);
	expect(overflow).toBeLessThanOrEqual(0);
});
