// SPDX-License-Identifier: AGPL-3.0-only
/** Phone layout (Pixel 7): no sideways scrolling, the menu drawer, full-screen editor. */
import type { Page } from '@playwright/test';
import { addManually, createAccount, expect, openFirstPouch, test } from './fixtures';

async function expectNoSidewaysScroll(page: Page): Promise<void> {
	const overflow = await page.evaluate(
		() => document.documentElement.scrollWidth - document.documentElement.clientWidth,
	);
	expect(overflow).toBeLessThanOrEqual(0);
}

test.describe('phone @mobile', () => {
	test('no page scrolls sideways', async ({ page }) => {
		await createAccount(page);
		await expectNoSidewaysScroll(page);
		await openFirstPouch(page);
		await expectNoSidewaysScroll(page);
		for (const path of ['skills', 'mcp-servers', 'shared', 'settings']) {
			await page.goto(
				`${page.url().replace(/\/(skills|mcp-servers|shared|settings)$/, '')}/${path}`,
			);
			await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
			await expectNoSidewaysScroll(page);
		}
		for (const path of ['', '/devices', '/security', '/billing']) {
			await page.goto(`/account${path}`);
			await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
			await expectNoSidewaysScroll(page);
		}
	});

	test('the menu drawer navigates between sections and closes', async ({ page }) => {
		await createAccount(page);
		await openFirstPouch(page);
		await page.getByRole('button', { name: 'Open menu' }).click();
		const drawer = page.getByRole('dialog');
		await expect(drawer.getByRole('link', { name: /^Skills/ })).toBeVisible();
		await expect(drawer.getByRole('button', { name: /Connect CLI/ })).toBeVisible();
		await drawer.getByRole('link', { name: /^Agents/ }).click();
		await expect(page.getByRole('heading', { level: 1, name: 'Agents' })).toBeVisible();
		await expect(page.getByRole('dialog')).toHaveCount(0);
	});

	test('adds a skill in the full-screen editor', async ({ page }) => {
		await createAccount(page);
		await openFirstPouch(page);
		await page.getByRole('button', { name: 'Open menu' }).click();
		await page
			.getByRole('dialog')
			.getByRole('link', { name: /^Skills/ })
			.click();
		await addManually(page, 'skill');
		const sheet = page.getByRole('dialog');
		const box = await sheet.boundingBox();
		expect(box!.width).toBeGreaterThanOrEqual(page.viewportSize()!.width - 1);
		await sheet.getByLabel('Item name').fill('phone-skill');
		await sheet.getByRole('button', { name: 'Add skill' }).click();
		await expect(page.getByText('Skill added')).toBeVisible();
		await expect(page.getByText('phone-skill').filter({ visible: true })).toBeVisible();
	});
});
