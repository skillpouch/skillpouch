// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The web app and the API share one origin in production (Caddy routes `/v1`
 * to the API). In development Vite proxies `/v1` the same way, so cookies,
 * CSRF checks and DPoP `htu` values behave exactly like production.
 */
import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const apiTarget = process.env.SKILLPOUCH_API_URL ?? 'http://localhost:8080';

export default defineConfig({
	plugins: [react(), tailwindcss()],
	resolve: {
		alias: {
			'@': fileURLToPath(new URL('./src', import.meta.url)),
			// Self-hosted Geist (the package's `exports` hide the font files).
			'@fonts': fileURLToPath(new URL('./node_modules/geist/dist/fonts', import.meta.url)),
		},
	},
	server: {
		port: Number(process.env.WEB_PORT ?? 5173),
		strictPort: true,
		proxy: {
			'/v1': { target: apiTarget, changeOrigin: false, ws: false },
		},
	},
	preview: {
		port: Number(process.env.WEB_PORT ?? 4173),
		strictPort: true,
		proxy: {
			'/v1': { target: apiTarget, changeOrigin: false },
		},
	},
	worker: { format: 'es' },
	build: {
		target: 'es2023',
		sourcemap: true,
	},
});
