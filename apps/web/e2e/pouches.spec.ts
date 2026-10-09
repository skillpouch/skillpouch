// SPDX-License-Identifier: AGPL-3.0-only
/** Pouches: plan limits, create, rename, delete, restore and purge, downgrade locking, sidebar. */
import { createAccount, expect, setPlan, test } from './fixtures';

test.describe('pouches', () => {
	test('Free shows the one-pouch limit instead of "New pouch"', async ({ page }) => {
		await createAccount(page);
		await expect(page.getByRole('article', { name: 'Personal' })).toBeVisible();
		await expect(page.getByText('Free plan: 1 pouch')).toBeVisible();
		await expect(page.getByRole('button', { name: 'New pouch' })).toHaveCount(0);
	});

	test('"New pouch" from the switcher says when the plan is full', async ({ page }) => {
		await createAccount(page);
		await page.getByRole('link', { name: 'Personal' }).first().click();
		await page.getByRole('button', { name: 'Personal' }).first().click();
		await page.getByRole('menuitem', { name: 'New pouch' }).click();
		const dialog = page.getByRole('dialog', { name: 'New pouch' });
		await expect(dialog.getByText(/Free includes 1 pouch/)).toBeVisible();
		await expect(dialog.getByLabel('Name')).toHaveCount(0);
		await dialog.getByRole('link', { name: 'See plans' }).click();
		await expect(page).toHaveURL(/\/app\/account\/billing$/);
	});

	test('Supporter creates a pouch with a validated, encrypted name', async ({ page }) => {
		await createAccount(page);
		await setPlan(page, 'supporter');
		await expect(page.getByRole('link', { name: 'Supporter' }).first()).toBeVisible();

		await page.getByRole('button', { name: 'New pouch' }).click();
		const dialog = page.getByRole('dialog', { name: 'New pouch' });
		const preview = dialog.getByTestId('new-pouch-preview');
		await expect(preview).toContainText('Untitled pouch');
		await expect(preview).toContainText('2 of 3');
		await dialog.getByRole('button', { name: 'Create pouch' }).click();
		await expect(dialog.getByRole('alert').or(dialog.getByText(/name/i)).first()).toBeVisible();
		await dialog.getByLabel('Name').fill('Work');
		await dialog.getByLabel('Description').fill('Things for the day job');
		await expect(preview).toContainText('WorkThings for the day job');
		await dialog.getByRole('button', { name: 'Create pouch' }).click();
		await expect(page).toHaveURL(/\/app\/p\/[0-9a-f-]+\/?$/);

		await page.goto('/app');
		await expect(page.getByRole('article', { name: 'Work' })).toContainText(
			'Things for the day job',
		);
		await expect(page.getByText('2 pouches')).toBeVisible();
		// The name survives a reload: it is decrypted from the roster, not cached.
		await page.reload();
		await expect(page.getByRole('article', { name: 'Work' })).toBeVisible();
	});

	test('renames a pouch in its settings', async ({ page }) => {
		await createAccount(page);
		await page.getByRole('link', { name: 'Personal' }).click();
		await page.getByRole('link', { name: 'Pouch settings' }).click();
		const save = page.getByRole('button', { name: 'Save', exact: true });
		await expect(save).toBeDisabled();
		await page.getByLabel('Name').fill('');
		await save.click();
		await expect(page.getByLabel('Name')).toHaveAttribute('aria-invalid', 'true');
		await page.getByLabel('Name').fill('Home setup');
		await save.click();
		await expect(page.getByText('Pouch updated')).toBeVisible();
		await page.goto('/app');
		await expect(page.getByRole('article', { name: 'Home setup' })).toBeVisible();
	});

	test('the only pouch cannot be deleted', async ({ page }) => {
		await createAccount(page);
		await page.getByRole('link', { name: 'Personal' }).click();
		await page.getByRole('link', { name: 'Pouch settings' }).click();
		await expect(page.getByText('This is your only pouch.')).toBeVisible();
		await expect(page.getByRole('button', { name: 'Delete pouch' })).toBeDisabled();
	});

	test('a deleted pouch counts down, restores, or is deleted permanently', async ({ page }) => {
		await createAccount(page);
		await setPlan(page, 'supporter');
		await page.getByRole('button', { name: 'New pouch' }).click();
		const dialog = page.getByRole('dialog', { name: 'New pouch' });
		await dialog.getByLabel('Name').fill('Work');
		await dialog.getByRole('button', { name: 'Create pouch' }).click();
		await expect(page).toHaveURL(/\/app\/p\/[0-9a-f-]+\/?$/);

		const remove = async () => {
			await page.goto('/app');
			await page.getByRole('link', { name: 'Personal' }).click();
			await page.getByRole('link', { name: 'Pouch settings' }).click();
			await page.getByRole('button', { name: 'Delete pouch' }).click();
			await page.getByRole('dialog').getByRole('button', { name: 'Delete pouch' }).click();
			await expect(page).toHaveURL(/\/app\/?$/);
		};
		await remove();
		const deleted = page.getByRole('article', { name: 'Personal (deleted)' });
		await expect(deleted).toContainText(/Deleted for good in 6 days 23 hours/);
		await deleted.getByRole('button', { name: 'Restore' }).click();
		await expect(page.getByRole('article', { name: 'Personal' })).toBeVisible();
		await expect(deleted).toHaveCount(0);

		await remove();
		await deleted.getByRole('button', { name: 'Delete permanently' }).click();
		const confirm = page.getByRole('dialog', { name: 'Delete “Personal” permanently?' });
		await confirm.getByRole('button', { name: 'Delete permanently' }).click();
		await expect(page.getByText('“Personal” deleted permanently')).toBeVisible();
		await expect(deleted).toHaveCount(0);
		await expect(page.getByRole('article', { name: 'Work' })).toBeVisible();
	});

	test('a downgrade locks the extra pouch; "Make active" swaps which one syncs', async ({
		page,
	}) => {
		await createAccount(page);
		await setPlan(page, 'supporter');
		await page.getByRole('button', { name: 'New pouch' }).click();
		const dialog = page.getByRole('dialog', { name: 'New pouch' });
		await dialog.getByLabel('Name').fill('Work');
		await dialog.getByRole('button', { name: 'Create pouch' }).click();
		await expect(page).toHaveURL(/\/app\/p\//);
		await page.goto('/app');

		await setPlan(page, 'free');
		await expect(page.getByText('1 pouch is locked')).toBeVisible();
		const work = page.getByRole('article', { name: 'Work' });
		await expect(work).toContainText('Locked');

		// A locked pouch opens read-only: no way to add items.
		await work.getByRole('link', { name: 'Open (read-only)' }).click();
		await expect(page.getByText('This pouch is locked on your current plan')).toBeVisible();
		await page
			.getByRole('link', { name: /^Skills/ })
			.first()
			.click();
		await expect(page.getByRole('button', { name: 'Add skill' })).toHaveCount(0);

		await page.goto('/app');
		await page
			.getByRole('article', { name: 'Work' })
			.getByRole('button', { name: 'Make active' })
			.click();
		const swap = page.getByRole('dialog', { name: 'Make “Work” active' });
		// At the limit the only active pouch is offered (preselected) as the one to lock.
		await expect(swap.getByRole('radio', { name: 'Personal' })).toBeChecked();
		await swap.getByRole('button', { name: 'Make active' }).click();
		await expect(page.getByRole('article', { name: 'Personal' })).toContainText('Locked');
		await expect(page.getByRole('article', { name: 'Work' })).not.toContainText('Locked');
	});

	test('collapsing the sidebar never moves its icons, and labels stay on one line', async ({
		page,
	}) => {
		await createAccount(page);
		await page.getByRole('link', { name: 'Personal' }).click();
		const sidebar = page.getByRole('complementary');
		const icons = sidebar.locator('a svg, button svg');
		const positions = () =>
			icons.evaluateAll((nodes) => nodes.map((node) => node.getBoundingClientRect().left));
		const cli = sidebar.getByRole('button', { name: 'Connect CLI' });

		const expanded = await positions();
		const cliHeight = (await cli.boundingBox())?.height;

		// Sample while the width animates, then after it settles.
		await sidebar.getByRole('button', { name: 'Collapse' }).click();
		await page.waitForTimeout(80);
		expect(await positions()).toEqual(expanded);
		await page.waitForTimeout(300);
		expect(await positions()).toEqual(expanded);

		// Collapsed: the logo mark and every icon sit on one centred line, and the
		// wordmark is hidden.
		const centres = await sidebar.locator('a svg, button svg, a img').evaluateAll((nodes) =>
			nodes.map((node) => {
				const box = node.getBoundingClientRect();
				return box.left + box.width / 2;
			}),
		);
		const width = (await sidebar.boundingBox())?.width ?? 0;
		for (const centre of centres) expect(Math.abs(centre - (width - 1) / 2)).toBeLessThan(1);
		await expect(sidebar.getByText('SkillPouch', { exact: true })).toHaveCSS('opacity', '0');

		await sidebar.getByRole('button', { name: 'Expand' }).click();
		await page.waitForTimeout(80);
		expect((await cli.boundingBox())?.height).toBe(cliHeight);
		expect(await positions()).toEqual(expanded);
	});

	test('the logo sits at the same spot in the top bar and in the sidebar', async ({ page }) => {
		await createAccount(page);
		const boxes = async (scope: 'banner' | 'complementary') => {
			const area = page.getByRole(scope).first();
			const mark = await area.locator('a img').first().boundingBox();
			const word = await area.getByText('SkillPouch', { exact: true }).boundingBox();
			return { mark, word };
		};
		const topBar = await boxes('banner');
		await page.getByRole('link', { name: 'Personal' }).click();
		await expect(page.getByRole('complementary')).toBeVisible();
		const sidebar = await boxes('complementary');
		expect(sidebar).toEqual(topBar);
	});

	test('the account sidebar offers Connect CLI', async ({ page }) => {
		await createAccount(page);
		await page.goto('/app/account');
		await page.getByRole('complementary').getByRole('button', { name: 'Connect CLI' }).click();
		await expect(page.getByRole('dialog')).toBeVisible();
	});
});
