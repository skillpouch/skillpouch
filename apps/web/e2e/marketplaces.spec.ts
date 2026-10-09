// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The Marketplaces page and the "Add" choice on item lists. Only the parts
 * that don't depend on skills.sh, the MCP Registry or GitHub being reachable.
 */
import { createAccount, expect, openFirstPouch, test } from './fixtures';

test.describe('marketplaces', () => {
	test.beforeEach(async ({ page }) => {
		await createAccount(page);
		await openFirstPouch(page);
	});

	test('the page lists the built-in marketplaces and the private-repo card sends you to link GitHub', async ({
		page,
	}) => {
		await page.getByRole('navigation').getByRole('link', { name: 'Marketplaces' }).click();
		await expect(page).toHaveURL(/\/marketplaces/);
		await expect(page.getByRole('heading', { name: 'Marketplaces' })).toBeVisible();

		const rail = page.getByRole('navigation', { name: 'Marketplaces' });
		for (const group of ['Directories', 'Featured']) {
			await expect(rail.getByText(group, { exact: true })).toBeVisible();
		}
		for (const name of [
			'skills.sh',
			'MCP Registry',
			'Anthropic Skills',
			'Vercel Agent Skills',
		]) {
			await expect(rail.getByText(name, { exact: true })).toBeVisible();
		}
		// Email accounts have no GitHub sign-in yet: the card sends them to link one.
		await page
			.getByLabel('Private repositories')
			.getByRole('link', { name: 'Link GitHub on your profile' })
			.click();
		await expect(page).toHaveURL(/\/app\/account#sign-in-methods$/);
		await expect(page.getByRole('region', { name: 'Sign-in methods' })).toBeVisible();
	});

	test('adding a marketplace checks the repository before it can be added', async ({ page }) => {
		await page.getByRole('navigation').getByRole('link', { name: 'Marketplaces' }).click();
		await page.getByRole('button', { name: 'Add marketplace' }).first().click();

		const dialog = page.getByRole('dialog', { name: 'Add a marketplace' });
		const add = dialog.getByRole('button', { name: 'Add marketplace' });
		await expect(dialog.getByText('Paste a link or type owner/name.')).toBeVisible();
		await expect(add).toBeDisabled();

		const input = dialog.getByLabel('Repository', { exact: true });
		await input.fill('not a repo');
		await expect(dialog.getByText('Use owner/name, like anthropics/skills.')).toBeVisible();
		await expect(add).toBeDisabled();

		await input.fill('https://github.com/acme/agent-tools/tree/main/skills');
		await expect(dialog.getByText('github.com/acme/agent-tools')).toBeVisible();
		await expect(add).toBeEnabled();

		await expect(dialog.getByRole('radio')).toHaveCount(0);
		await dialog.getByRole('button', { name: 'Close' }).click();
		await expect(dialog).toBeHidden();
	});

	test('Add on an item list offers writing it, a marketplace or GitHub', async ({ page }) => {
		await page
			.getByRole('navigation')
			.getByRole('link', { name: /^Skills/ })
			.first()
			.click();
		await page.getByRole('button', { name: 'Add skill' }).first().click();

		const choose = page.getByRole('dialog', { name: 'Add skill' });
		await expect(choose.getByRole('button', { name: /Write it yourself/ })).toBeVisible();
		await choose.getByRole('button', { name: /From a marketplace/ }).click();

		const browse = page.getByRole('dialog', { name: 'Add skill from a marketplace' });
		await expect(browse.getByRole('button', { name: 'Choose marketplace' })).toBeVisible();
		await expect(browse.getByRole('button', { name: 'All ways to add' })).toHaveCount(1);
		await expect(browse.getByRole('button', { name: /^Review / })).toHaveCount(0);
		await page.keyboard.press('Escape');
		await expect(browse).toBeHidden();

		await page.getByRole('button', { name: 'Add skill' }).first().click();
		await page
			.getByRole('dialog', { name: 'Add skill' })
			.getByRole('button', { name: /From GitHub/ })
			.click();
		const github = page.getByRole('dialog', { name: 'Add skill from GitHub' });
		const find = github.getByRole('button', { name: 'Find' });
		await expect(find).toBeDisabled();
		await github.getByLabel('Repository', { exact: true }).fill('acme/pdf-skill');
		await expect(find).toBeEnabled();
		await github.getByRole('button', { name: 'All ways to add' }).click();
		await expect(page.getByRole('dialog', { name: 'Add skill' })).toBeVisible();
	});
});
