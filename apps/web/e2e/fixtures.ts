// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Shared steps for the end-to-end specs. Every spec creates its own user
 * (unique email), so specs never share server state and run in parallel.
 */
import { randomUUID } from 'node:crypto';
import { expect, test as base, type Browser, type Page } from '@playwright/test';

export const PASSWORD = 'correct horse battery staple 42';

export interface Account {
	email: string;
	password: string;
	recoveryKey: string;
}

export function uniqueEmail(prefix = 'e2e'): string {
	return `${prefix}-${randomUUID().slice(0, 8)}@skillpouch.test`;
}

/** Signs in through the development sign-in form on /sign-in. */
export async function signIn(page: Page, email: string, path = '/sign-in'): Promise<void> {
	await page.goto(path);
	const form = page.getByRole('form', { name: 'Development sign-in' });
	await form.getByLabel('Email').fill(email);
	await form.getByRole('button', { name: 'Sign in' }).click();
}

/** Runs the three onboarding steps and returns the Recovery Key shown on step 2. */
export async function completeSetup(
	page: Page,
	options: { password?: string; trust?: boolean } = {},
): Promise<string> {
	const password = options.password ?? PASSWORD;
	await expect(page.getByRole('heading', { name: 'Create your master password' })).toBeVisible();
	await page.getByLabel('Master password').fill(password);
	await page.getByLabel('Confirm password').fill(password);
	await page.getByRole('button', { name: 'Continue' }).click();

	await expect(page.getByRole('heading', { name: 'Save your Recovery Key' })).toBeVisible();
	const words = await page
		.getByTestId('recovery-key')
		.locator('li > span:last-child')
		.allTextContents();
	expect(words).toHaveLength(12);
	await page.getByRole('checkbox', { name: 'I saved my Recovery Key' }).click();
	await page.getByRole('button', { name: 'Continue' }).click();

	await expect(page.getByRole('heading', { name: 'Trust this browser?' })).toBeVisible();
	const trust = page.getByRole('switch', { name: 'Trust this browser' });
	if ((options.trust ?? true) !== ((await trust.getAttribute('aria-checked')) === 'true')) {
		await trust.click();
	}
	await page.getByRole('button', { name: 'Finish setup' }).click();
	await expect(page).toHaveURL(/\/app\/?$/, { timeout: 30_000 });
	return words.join(' ');
}

/** A brand new account: signed in, set up and looking at the pouches grid. */
export async function createAccount(page: Page, prefix?: string): Promise<Account> {
	const email = uniqueEmail(prefix);
	await signIn(page, email);
	const recoveryKey = await completeSetup(page);
	return { email, password: PASSWORD, recoveryKey };
}

/** Unlocks on /unlock with the master password (default) or the Recovery Key. */
export async function unlock(
	page: Page,
	secret: string,
	method: 'password' | 'recovery' = 'password',
): Promise<void> {
	await expect(page.getByRole('heading', { name: 'Unlock SkillPouch' })).toBeVisible();
	if (method === 'recovery') {
		await page.getByRole('button', { name: 'Use Recovery Key instead' }).click();
		await page.getByLabel('Recovery Key').fill(secret);
	} else {
		await page.getByLabel('Master password').fill(secret);
	}
	await page.getByRole('button', { name: 'Unlock', exact: true }).click();
}

/** A second, independent browser (own IndexedDB, own cookies) for the same or another user. */
export async function newBrowser(browser: Browser): Promise<Page> {
	const context = await browser.newContext();
	return context.newPage();
}

/** Opens the first pouch from the pouches grid. */
/** Opens the editor for a new item: "Add …", then "Write it yourself". */
export async function addManually(page: Page, singular: string): Promise<void> {
	await page
		.getByRole('button', { name: `Add ${singular}` })
		.first()
		.click();
	await page.getByRole('button', { name: /Write it yourself/ }).click();
}

export async function openFirstPouch(page: Page, name = 'Personal'): Promise<void> {
	await page
		.getByRole('link', { name: new RegExp(name) })
		.first()
		.click();
	await expect(page).toHaveURL(/\/app\/p\/[0-9a-f-]+\/?$/);
}

/**
 * Moves the signed-in account to another plan through the dev-only API
 * (`free`, `supporter`). The page must be inside the app (`/app…`).
 */
export async function setPlan(page: Page, planSlug: string): Promise<void> {
	await page.waitForFunction(() => window.__skillpouchDev !== undefined);
	await page.evaluate((slug) => window.__skillpouchDev!.setPlan(slug), planSlug);
}

export const test = base;
export { expect };
