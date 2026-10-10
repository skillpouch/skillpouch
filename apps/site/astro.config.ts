// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The public site (landing page, Terms, Privacy) as static HTML, served at
 * the root of `skillpouch.net`. The web app has its own host; links into it
 * are absolute (`src/lib/links.ts`).
 */
import { fileURLToPath } from 'node:url';
import react from '@astrojs/react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'astro/config';

export default defineConfig({
	site: 'https://skillpouch.net',
	output: 'static',
	integrations: [react()],
	devToolbar: { enabled: false },
	server: { port: Number(process.env.SITE_PORT ?? 4321) },
	vite: {
		plugins: [tailwindcss()],
		resolve: {
			alias: {
				// Self-hosted Geist (the package's `exports` hide the font files).
				'@fonts': fileURLToPath(
					new URL('./node_modules/geist/dist/fonts', import.meta.url),
				),
			},
		},
	},
});
