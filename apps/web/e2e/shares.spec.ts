// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Share links: sealed in the sharer's browser, opened with the key from the
 * link fragment (never sent to the server), imported into another account.
 */
import type { Browser, Page } from '@playwright/test';
import { createAccount, expect, newBrowser, openFirstPouch, test } from './fixtures';

async function shareSkill(page: Page, name: string, options: { oneTime?: boolean } = {}) {
	await openFirstPouch(page);
	await page
		.getByRole('navigation')
		.getByRole('link', { name: /^Skills/ })
		.first()
		.click();
	await page.getByRole('button', { name: 'Add skill' }).first().click();
	await page.getByRole('dialog').getByLabel('Item name').fill(name);
	await page.getByRole('dialog').getByRole('button', { name: 'Add skill' }).click();
	await expect(page.getByText('Skill added')).toBeVisible();

	await page.getByRole('button', { name: `Actions for ${name}` }).click();
	await page.getByRole('menuitem', { name: 'Share' }).click();
	const dialog = page.getByRole('dialog', { name: `Share ${name}` });
	if (options.oneTime) await dialog.getByLabel('Allow only one import').click();
	await dialog.getByRole('button', { name: 'Create link' }).click();
	const url = await dialog.getByLabel('Link').inputValue();
	expect(url).toMatch(/\/s\/[0-9a-f-]+#key=[A-Za-z0-9_-]{43}$/);
	await dialog.getByRole('button', { name: 'Done' }).click();
	return url;
}

async function recipient(browser: Browser): Promise<Page> {
	const page = await newBrowser(browser);
	await createAccount(page, 'recipient');
	return page;
}

test.describe('share links', () => {
	// Two accounts (two Argon2 derivations) per test.
	test.slow();

	test('anyone with the link sees the item, decrypted in their browser', async ({
		page,
		browser,
	}) => {
		await createAccount(page);
		const url = await shareSkill(page, 'shared-skill');

		const stranger = await newBrowser(browser);
		await stranger.goto(url);
		await expect(stranger.getByRole('heading', { name: 'shared-skill' })).toBeVisible();
		await expect(stranger.getByText('name: shared-skill').first()).toBeVisible();
		await expect(
			stranger.getByRole('link', { name: 'Sign in to add it to your pouch' }),
		).toBeVisible();
	});

	test('without the key part of the link nothing can be read', async ({ page, browser }) => {
		await createAccount(page);
		const url = await shareSkill(page, 'keyless');
		const stranger = await newBrowser(browser);
		await stranger.goto(url.split('#')[0]!);
		await expect(stranger.getByRole('heading', { name: 'Link unavailable' })).toBeVisible();
		await expect(stranger.getByText('The key is missing')).toBeVisible();
	});

	test('another account adds the shared item to its own pouch', async ({ page, browser }) => {
		await createAccount(page);
		const url = await shareSkill(page, 'gift');
		const other = await recipient(browser);
		await other.goto(url);
		await other.getByRole('button', { name: 'Add to my pouch' }).click();
		await other
			.getByRole('dialog', { name: 'Add to which pouch?' })
			.getByRole('button', { name: 'Add to pouch' })
			.click();
		await expect(other.getByRole('heading', { name: 'Added to Personal' })).toBeVisible();
		await other.getByRole('link', { name: 'Open in pouch' }).click();
		await expect(other.getByRole('row').filter({ hasText: 'gift' })).toBeVisible();
	});

	test('a revoked link stops working', async ({ page, browser }) => {
		await createAccount(page);
		const url = await shareSkill(page, 'revoke-me');
		await page.getByRole('link', { name: 'Shared links' }).click();
		await page.getByRole('button', { name: 'Revoke' }).first().click();
		await page
			.getByRole('dialog', { name: 'Revoke this link?' })
			.getByRole('button', { name: 'Revoke' })
			.click();

		const stranger = await newBrowser(browser);
		await stranger.goto(url);
		await expect(stranger.getByRole('heading', { name: 'Link unavailable' })).toBeVisible();
	});

	test('a one-time link works exactly once', async ({ page, browser }) => {
		await createAccount(page);
		const url = await shareSkill(page, 'once', { oneTime: true });
		const other = await recipient(browser);
		await other.goto(url);
		await other.getByRole('button', { name: 'Open and add to my pouch' }).click();
		await other
			.getByRole('dialog', { name: 'Add to which pouch?' })
			.getByRole('button', { name: 'Add to pouch' })
			.click();
		await expect(other.getByRole('heading', { name: 'Added to Personal' })).toBeVisible();

		const late = await newBrowser(browser);
		await late.goto(url);
		await expect(late.getByRole('heading', { name: 'Link unavailable' })).toBeVisible();
	});
});
