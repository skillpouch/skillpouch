// SPDX-License-Identifier: AGPL-3.0-only
/**
 * End-to-end tests: the real API (fresh database, dev sign-in) behind the
 * real Vite dev server, driven through Chromium. Each spec signs in as its
 * own user, so specs run in parallel without sharing state.
 */
import { defineConfig, devices } from '@playwright/test';

const apiPort = process.env.E2E_API_PORT ?? '18080';
const webPort = process.env.E2E_WEB_PORT ?? '15173';
export const baseURL = `http://localhost:${webPort}`;

export default defineConfig({
	testDir: './e2e',
	timeout: 60_000,
	expect: { timeout: 10_000 },
	fullyParallel: true,
	workers: process.env.CI ? 2 : 4,
	retries: process.env.CI ? 1 : 0,
	reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : [['list']],
	use: {
		baseURL,
		trace: 'retain-on-failure',
		screenshot: 'only-on-failure',
		launchOptions: process.env.PLAYWRIGHT_CHROMIUM_PATH
			? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH }
			: {},
	},
	projects: [
		{ name: 'desktop', use: { ...devices['Desktop Chrome'] }, grepInvert: /@mobile/ },
		{ name: 'mobile', use: { ...devices['Pixel 7'] }, grep: /@mobile/ },
	],
	webServer: [
		{
			command: 'node --import tsx e2e/stack.ts',
			url: `http://127.0.0.1:${apiPort}/readyz`,
			reuseExistingServer: false,
			timeout: 180_000,
			env: { E2E_API_PORT: apiPort, E2E_WEB_PORT: webPort },
		},
		{
			command: `vite --port ${webPort} --strictPort`,
			url: `${baseURL}/sign-in`,
			reuseExistingServer: false,
			timeout: 120_000,
			env: {
				SKILLPOUCH_API_URL: `http://127.0.0.1:${apiPort}`,
				WEB_PORT: webPort,
			},
		},
	],
});
