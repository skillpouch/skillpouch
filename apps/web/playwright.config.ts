// SPDX-License-Identifier: AGPL-3.0-only
/**
 * End-to-end tests: the real API (fresh database, dev sign-in) behind the
 * real Vite dev server, with the landing page on the site's dev server
 * (apps/site; Vite redirects `/` there), driven through Chromium. Each spec signs in as its
 * own user, so specs run in parallel without sharing state.
 */
import { defineConfig, devices } from '@playwright/test';

const apiPort = process.env.E2E_API_PORT ?? '18080';
const webPort = process.env.E2E_WEB_PORT ?? '15173';
const sitePort = process.env.E2E_SITE_PORT ?? '14321';
export const baseURL = `http://localhost:${webPort}`;
const siteURL = `http://localhost:${sitePort}`;

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
			// Not `/`: it redirects to the site, which only starts after this server.
			url: `${baseURL}/sign-in`,
			reuseExistingServer: false,
			timeout: 120_000,
			env: {
				SKILLPOUCH_API_URL: `http://127.0.0.1:${apiPort}`,
				SKILLPOUCH_SITE_URL: siteURL,
				WEB_PORT: webPort,
			},
		},
		{
			// `--ignore-lock` keeps it in the foreground next to a developer's own site server.
			command: `pnpm --dir ../site exec astro dev --port ${sitePort} --ignore-lock`,
			url: `${siteURL}/_site/`,
			reuseExistingServer: false,
			// A cold CI runner optimizes the site's dependencies (three.js and
			// friends) on the first request; give it room.
			timeout: 180_000,
			env: {
				SKILLPOUCH_API_URL: `http://127.0.0.1:${apiPort}`,
				SKILLPOUCH_APP_URL: baseURL,
				ASTRO_TELEMETRY_DISABLED: '1',
			},
		},
	],
});
