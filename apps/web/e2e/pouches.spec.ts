// SPDX-License-Identifier: AGPL-3.0-only
/** Pouches: plan limits, create, rename, delete and restore, downgrade locking. */
import { createAccount, expect, setPlan, test } from './fixtures';

test.describe('pouches', () => {
	test('Free shows the one-pouch limit instead of "New pouch"', async ({ page }) => {
		await createAccount(page);
		await expect(page.getByRole('article', { name: 'Personal' })).toBeVisible();
		await expect(page.getByText('Free plan: 1 pouch')).toBeVisible();
		await expect(page.getByRole('button', { name: 'New pouch' })).toHaveCount(0);
	});

	test('Supporter creates a pouch with a validated, encrypted name', async ({ page }) => {
		await createAccount(page);
		await setPlan(page, 'supporter');
		await expect(page.getByRole('link', { name: 'Supporter' }).first()).toBeVisible();

		await page.getByRole('button', { name: 'New pouch' }).click();
		const dialog = page.getByRole('dialog', { name: 'New pouch' });
		await dialog.getByRole('button', { name: 'Create pouch' }).click();
		await expect(dialog.getByRole('alert').or(dialog.getByText(/name/i)).first()).toBeVisible();
		await dialog.getByLabel('Name').fill('Work');
		await dialog.getByLabel('Description').fill('Things for the day job');
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

	test('deletes a pouch and restores it within the undo window', async ({ page }) => {
		await createAccount(page);
		await page.getByRole('link', { name: 'Personal' }).click();
		await page.getByRole('link', { name: 'Pouch settings' }).click();
		await page.getByRole('button', { name: 'Delete pouch' }).click();
		await page.getByRole('dialog').getByRole('button', { name: 'Delete pouch' }).click();
		await expect(page).toHaveURL(/\/app\/?$/);
		const deleted = page.getByRole('article', { name: 'Personal (deleted)' });
		await expect(deleted).toBeVisible();
		await deleted.getByRole('button', { name: 'Restore' }).click();
		await expect(page.getByRole('article', { name: 'Personal' })).toBeVisible();
		await expect(deleted).toHaveCount(0);
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
});
