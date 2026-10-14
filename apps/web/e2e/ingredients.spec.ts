// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Ingredients: the encrypted multi-file editor. Every save is sealed and
 * signed in the browser; every list is decrypted from the server's ciphertext,
 * so a reload proves the round trip.
 */
import type { Locator, Page } from '@playwright/test';
import { addManually, createAccount, expect, openFirstPouch, test } from './fixtures';

async function openKind(page: Page, label: string): Promise<void> {
	await page
		.getByRole('navigation')
		.getByRole('link', { name: new RegExp(`^${label}`) })
		.first()
		.click();
	await expect(page.getByRole('heading', { level: 1, name: label })).toBeVisible();
}

/** Replaces the whole text of the open CodeMirror file. */
async function typeInEditor(
	page: Page,
	path: string,
	text: string,
	within: Page | Locator = page,
): Promise<void> {
	const editor = within.getByLabel(`Contents of ${path}`);
	await editor.click();
	await page.keyboard.press('ControlOrMeta+a');
	await page.keyboard.press('Delete');
	await editor.pressSequentially(text);
}

async function addSkill(page: Page, name: string, body?: string): Promise<void> {
	await addManually(page, 'skill');
	const sheet = page.getByRole('dialog');
	await sheet.getByLabel('Item name').fill(name);
	if (body !== undefined) await typeInEditor(page, 'SKILL.md', body);
	await sheet.getByRole('button', { name: 'Add skill' }).click();
	await expect(page.getByText('Skill added')).toBeVisible();
}

function row(page: Page, name: string) {
	return page.getByRole('row').filter({ has: page.getByText(name, { exact: true }) });
}

test.describe('ingredients', () => {
	test.beforeEach(async ({ page }) => {
		await createAccount(page);
		await openFirstPouch(page);
	});

	test('every kind has its own empty page', async ({ page }) => {
		for (const label of [
			'Instructions',
			'Skills',
			'Agents',
			'Commands',
			'MCP Servers',
			'Hooks',
			'Plugins',
		]) {
			await openKind(page, label);
			await expect(page.getByText(`No ${label.toLowerCase()} yet`)).toBeVisible();
			if (label !== 'Instructions') {
				await expect(page.getByRole('button', { name: /^Add / })).toHaveCount(1);
			}
		}
	});

	test('Add always asks where the item comes from', async ({ page }) => {
		await openKind(page, 'Skills');
		await page.getByRole('button', { name: 'Add skill' }).click();
		const choose = page.getByRole('dialog', { name: 'Add skill' });
		await expect(choose.getByRole('button', { name: /From GitHub/ })).toBeVisible();
		await page.keyboard.press('Escape');

		await openKind(page, 'Hooks');
		await page.getByRole('button', { name: 'Add hook' }).click();
		const hooks = page.getByRole('dialog', { name: 'Add hook' });
		await expect(hooks.getByRole('button', { name: /Write it yourself/ })).toBeVisible();
		await expect(hooks.getByRole('button', { name: /From GitHub/ })).toHaveCount(0);
	});

	test('a pouch has one set of instructions, shown and edited in place', async ({ page }) => {
		await openKind(page, 'Instructions');
		await page.getByRole('button', { name: 'Write instructions' }).click();
		const sheet = page.getByRole('dialog');
		await expect(sheet.getByLabel('Item name')).toHaveCount(0);
		await typeInEditor(page, 'INSTRUCTIONS.md', '# Rules\n\nAlways write tests.');
		await sheet.getByRole('button', { name: 'Save changes' }).click();
		await expect(page.getByText('Instructions saved')).toBeVisible();

		await page.reload();
		const card = page.getByRole('region', { name: 'Instructions' });
		await expect(card.getByLabel('Contents of INSTRUCTIONS.md')).toContainText(
			'Always write tests.',
		);
		await expect(page.getByRole('button', { name: /Add instructions/ })).toHaveCount(0);
		await expect(page.getByRole('table')).toHaveCount(0);

		await card.getByRole('button', { name: 'Edit' }).click();
		await typeInEditor(
			page,
			'INSTRUCTIONS.md',
			'# Rules\n\nUse pnpm.',
			page.getByRole('dialog'),
		);
		await page.getByRole('dialog').getByRole('button', { name: 'Save changes' }).click();
		await expect(page.getByRole('dialog').getByRole('button', { name: 'Edit' })).toBeVisible();
		await page.keyboard.press('Escape');
		await expect(card.getByLabel('Contents of INSTRUCTIONS.md')).toContainText('Use pnpm.');
		await expect(
			page
				.getByRole('navigation')
				.getByRole('link', { name: /^Instructions/ })
				.first(),
		).toHaveText('Instructions');
	});

	test('a new skill’s template follows its name, and it saves encrypted', async ({ page }) => {
		await openKind(page, 'Skills');
		await addManually(page, 'skill');
		const sheet = page.getByRole('dialog');
		await sheet.getByLabel('Item name').fill('pdf-tools');
		await expect(sheet.getByLabel('Contents of SKILL.md')).toContainText('name: pdf-tools');
		await expect(sheet.getByLabel('Contents of SKILL.md')).toContainText('# pdf-tools');
		await sheet.getByRole('button', { name: 'Add skill' }).click();
		await expect(page.getByText('Skill added')).toBeVisible();
		await expect(row(page, 'pdf-tools')).toContainText('Synced');

		await page.reload();
		await expect(row(page, 'pdf-tools')).toContainText('What this skill does');
		await expect(
			page
				.getByRole('navigation')
				.getByRole('link', { name: /^Skills/ })
				.first(),
		).toContainText('1');
	});

	test('rejects bad names and duplicate names', async ({ page }) => {
		await openKind(page, 'Skills');
		await addManually(page, 'skill');
		const sheet = page.getByRole('dialog');
		await sheet.getByLabel('Item name').fill('bad name!');
		await sheet.getByRole('button', { name: 'Add skill' }).click();
		await expect(sheet.getByRole('alert')).toBeVisible();
		await sheet.getByRole('button', { name: 'Discard' }).click();
		await page
			.getByRole('dialog', { name: 'Discard changes?' })
			.getByRole('button', { name: 'Discard' })
			.click();

		await addSkill(page, 'twin');
		await addManually(page, 'skill');
		await page.getByRole('dialog').getByLabel('Item name').fill('TWIN');
		await page.getByRole('dialog').getByRole('button', { name: 'Add skill' }).click();
		await expect(page.getByRole('dialog').getByRole('alert')).toContainText(
			'There is already a skill called “twin”',
		);
		await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click();
		await page
			.getByRole('dialog', { name: 'Discard changes?' })
			.getByRole('button', { name: 'Discard' })
			.click();
		await expect(page.getByRole('row').filter({ hasText: /twin/i })).toHaveCount(1);
	});

	test('multi-file edit: add a file, change the main file, see the change count', async ({
		page,
	}) => {
		await openKind(page, 'Skills');
		await addSkill(page, 'deploy', '---\nname: deploy\ndescription: Ships it.\n---\n');
		await page.getByRole('button', { name: 'Actions for deploy' }).click();
		await page.getByRole('menuitem', { name: 'Edit' }).click();
		const sheet = page.getByRole('dialog');
		await expect(sheet.getByText('No changes')).toBeVisible();
		await expect(sheet.getByRole('button', { name: 'Save changes' })).toBeDisabled();

		await sheet.getByRole('button', { name: 'New file' }).click();
		const prompt = page.getByRole('dialog', { name: 'New file' });
		await prompt.getByLabel('Path').fill('../escape.sh');
		await prompt.getByRole('button', { name: 'Create' }).click();
		await expect(prompt.getByRole('alert').or(prompt.getByText(/path/i)).first()).toBeVisible();
		await prompt.getByLabel('Path').fill('scripts/run.sh');
		await prompt.getByRole('button', { name: 'Create' }).click();
		await typeInEditor(page, 'scripts/run.sh', 'echo shipping');

		await sheet
			.getByRole('tab', { name: /SKILL\.md/ })
			.or(sheet.getByText('SKILL.md').first())
			.first()
			.click();
		await typeInEditor(
			page,
			'SKILL.md',
			'---\nname: deploy\ndescription: Ships it twice.\n---\n',
		);
		await expect(sheet.getByText('2 files changed')).toBeVisible();
		await sheet.getByRole('button', { name: 'Save changes' }).click();
		await expect(sheet.getByRole('button', { name: 'Edit' })).toBeVisible();
		await sheet.getByRole('button', { name: 'Close', exact: true }).click();

		await page.reload();
		await expect(row(page, 'deploy')).toContainText('Ships it twice.');
		await expect(row(page, 'deploy')).toContainText('2');
		await page.getByRole('button', { name: 'Actions for deploy' }).click();
		await page.getByRole('menuitem', { name: 'Show' }).click();
		await page.getByRole('dialog').getByText('run.sh', { exact: true }).first().click();
		await expect(page.getByLabel('Contents of scripts/run.sh')).toContainText('echo shipping');
	});

	test('closing with unsaved edits asks first', async ({ page }) => {
		await openKind(page, 'Skills');
		await addSkill(page, 'careful');
		await page.getByRole('button', { name: 'Actions for careful' }).click();
		await page.getByRole('menuitem', { name: 'Edit' }).click();
		await typeInEditor(page, 'SKILL.md', 'changed');
		await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click();
		const confirm = page.getByRole('dialog', { name: 'Discard changes?' });
		await expect(confirm).toBeVisible();
		await confirm.getByRole('button', { name: 'Cancel' }).click();
		await expect(page.getByLabel('Contents of SKILL.md')).toContainText('changed');
	});

	test('deletes an item after confirming', async ({ page }) => {
		await openKind(page, 'Skills');
		await addSkill(page, 'old-one');
		await page.getByRole('button', { name: 'Actions for old-one' }).click();
		await page.getByRole('menuitem', { name: 'Delete' }).click();
		await page
			.getByRole('dialog', { name: 'Delete old-one?' })
			.getByRole('button', { name: 'Delete' })
			.click();
		await expect(page.getByText('old-one deleted')).toBeVisible();
		await expect(page.getByText('No skills yet')).toBeVisible();
		await page.reload();
		await expect(page.getByText('No skills yet')).toBeVisible();
	});

	test('MCP servers use their own main file', async ({ page }) => {
		await openKind(page, 'MCP Servers');
		await addManually(page, 'mcp server');
		const sheet = page.getByRole('dialog');
		await sheet.getByLabel('Item name').fill('postgres');
		await expect(sheet.getByLabel('Contents of server.json')).toBeVisible();
		await sheet.getByRole('button', { name: 'Add mcp server' }).click();
		await expect(page.getByText('MCP Server added')).toBeVisible();
		await expect(row(page, 'postgres')).toBeVisible();
	});

	test('clicking anywhere on a row opens the item; the ⋯ menu does not', async ({ page }) => {
		await openKind(page, 'Skills');
		await addSkill(page, 'row-click');
		await row(page, 'row-click').getByText('Synced').click();
		await expect(page.getByLabel('Contents of SKILL.md')).toContainText('row-click');
		await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click();
		await expect(page.getByRole('dialog')).toHaveCount(0);
		await page.getByRole('button', { name: 'Actions for row-click' }).click();
		await expect(page.getByRole('menu')).toBeVisible();
		await expect(page.getByLabel('Contents of SKILL.md')).toHaveCount(0);
	});

	test('names stop at 64 characters', async ({ page }) => {
		await openKind(page, 'Skills');
		await addManually(page, 'skill');
		const name = page.getByRole('dialog').getByLabel('Item name');
		await name.fill('a'.repeat(80));
		await expect(name).toHaveValue('a'.repeat(64));
	});

	test('search finds items by their decrypted name', async ({ page }) => {
		await openKind(page, 'Skills');
		await addSkill(page, 'needle-in-pouch');
		await page.getByRole('button', { name: 'Search' }).click();
		await page.keyboard.type('needle');
		await page.keyboard.press('Enter');
		await expect(page.getByLabel('Contents of SKILL.md')).toContainText('needle-in-pouch');
	});

	test('search works on account pages and finds settings and this browser', async ({ page }) => {
		await page.goto('/account');
		await page.getByRole('button', { name: 'Search' }).click();
		await page.keyboard.type('recovery key');
		await page.keyboard.press('Enter');
		await expect(page).toHaveURL(/\/account\/security$/);
		await page.keyboard.press('ControlOrMeta+k');
		await page.keyboard.type('this browser');
		await expect(page.getByRole('option', { name: /this browser/ })).toBeVisible();
		await page.keyboard.press('Enter');
		await expect(page).toHaveURL(/\/account\/devices$/);
	});
});
