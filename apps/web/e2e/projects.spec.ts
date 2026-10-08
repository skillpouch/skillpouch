// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Projects: items scoped to one folder. They live in the same pouch, sealed
 * like everything else, but never show up in the global lists.
 */
import type { Page } from '@playwright/test';
import { createAccount, expect, openFirstPouch, test } from './fixtures';

function nav(page: Page, name: RegExp) {
	return page.getByRole('navigation').getByRole('link', { name }).first();
}

async function addInstructions(page: Page, name: string): Promise<void> {
	await page.getByRole('button', { name: 'Add instructions' }).first().click();
	const sheet = page.getByRole('dialog');
	await sheet.getByLabel('Item name').fill(name);
	await sheet.getByRole('button', { name: 'Add instructions' }).click();
	await expect(page.getByText('Instructions added')).toBeVisible();
}

test.describe('projects', () => {
	test.beforeEach(async ({ page }) => {
		await createAccount(page);
		await openFirstPouch(page);
	});

	test('a project keeps its own instruction files, apart from the global ones', async ({
		page,
	}) => {
		await nav(page, /^Projects/).click();
		await expect(page.getByText('No projects yet')).toBeVisible();
		await expect(page.getByText('skillpouch init')).toBeVisible();

		await page.getByRole('button', { name: 'New project' }).first().click();
		const dialog = page.getByRole('dialog');
		await dialog.getByLabel('Name').fill('web-app');
		await dialog.getByLabel('Description').fill('The storefront');
		await dialog.getByRole('button', { name: 'Create project' }).click();

		await expect(page.getByRole('heading', { level: 1, name: 'web-app' })).toBeVisible();
		await expect(page.getByText('The storefront')).toBeVisible();
		await expect(page.getByText('Project ID')).toBeVisible();
		await expect(page.getByRole('radio', { name: 'Instructions' })).toHaveAttribute(
			'data-state',
			'on',
		);
		await expect(page.getByText('AGENTS.md, CLAUDE.md, GEMINI.md')).toBeVisible();

		await addInstructions(page, 'AGENTS.md');
		await addInstructions(page, 'CLAUDE.md');
		await expect(page.getByRole('radio', { name: 'Instructions 2' })).toBeVisible();

		await page.reload();
		await expect(page.getByRole('row').filter({ hasText: 'CLAUDE.md' })).toBeVisible();
		await expect(nav(page, /^Projects/)).toContainText('1');

		await nav(page, /^Instructions/).click();
		await expect(page.getByText('No instructions yet')).toBeVisible();
		await expect(nav(page, /^Instructions/)).toContainText('0');

		await nav(page, /^Projects/).click();
		const project = page.getByRole('row').filter({ hasText: 'web-app' });
		await expect(project).toContainText('The storefront');
		await expect(project).toContainText('2 Instructions');
	});

	test('editing and deleting a project', async ({ page }) => {
		await nav(page, /^Projects/).click();
		await page.getByRole('button', { name: 'New project' }).first().click();
		await page.getByRole('dialog').getByLabel('Name').fill('api');
		await page.getByRole('dialog').getByRole('button', { name: 'Create project' }).click();
		await addInstructions(page, 'AGENTS.md');

		await page.getByRole('button', { name: 'Edit' }).click();
		await page.getByRole('dialog').getByLabel('Name').fill('backend');
		await page.getByRole('dialog').getByRole('button', { name: 'Save' }).click();
		await expect(page.getByRole('heading', { level: 1, name: 'backend' })).toBeVisible();
		await expect(page.getByRole('row').filter({ hasText: 'AGENTS.md' })).toBeVisible();

		await page.getByRole('button', { name: 'Delete' }).first().click();
		await expect(page.getByText('Its 1 item will be removed')).toBeVisible();
		await page.getByRole('button', { name: 'Delete project' }).click();
		await expect(page.getByText('backend deleted')).toBeVisible();
		await expect(page.getByText('No projects yet')).toBeVisible();
		await expect(nav(page, /^Projects/)).toContainText('0');
	});
});
