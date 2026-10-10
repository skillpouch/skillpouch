// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The landing page as static HTML. Everything the site serves lives under
 * `/_site/` so it never collides with the web app's `/assets/`; in production
 * Caddy serves exactly `/` from `/_site/index.html`. Links into the web app
 * (`/sign-in`, `/app`, `/terms`) are plain full-page navigations.
 *
 * In development the site has its own server: the web app's dev server
 * redirects `/` here, `/v1` is proxied to the API (cookies are per host, not
 * per port, so the session is shared), and any other path goes back to the
 * web app.
 */
import { fileURLToPath } from 'node:url';
import react from '@astrojs/react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'astro/config';
import type { Connect, Plugin } from 'vite';

const apiTarget = process.env.SKILLPOUCH_API_URL ?? 'http://localhost:8080';
const appUrl = process.env.SKILLPOUCH_APP_URL ?? 'http://localhost:5173';
const OWN_PATHS = ['/_site', '/v1/', '/@', '/__', '/src/', '/node_modules/'];

function webAppLinks(): Plugin {
	return {
		name: 'skillpouch:web-app-links',
		apply: 'serve',
		configureServer(server) {
			// Astro puts its base handler (a 404 for pages outside `/_site`) at the
			// front of the stack once set up; this goes in front of it afterwards.
			return () => {
				const handle: Connect.NextHandleFunction = (req, res, next) => {
					const url = req.url ?? '/';
					if (OWN_PATHS.some((prefix) => url.startsWith(prefix))) return next();
					res.statusCode = 302;
					res.setHeader('Location', `${appUrl}${url}`);
					res.end();
				};
				server.middlewares.stack.unshift({ route: '', handle });
			};
		},
	};
}

export default defineConfig({
	site: 'https://skillpouch.net',
	base: '/_site',
	output: 'static',
	integrations: [react()],
	devToolbar: { enabled: false },
	server: { port: Number(process.env.SITE_PORT ?? 4321) },
	vite: {
		plugins: [tailwindcss(), webAppLinks()],
		server: {
			proxy: { '/v1': { target: apiTarget, changeOrigin: false } },
		},
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
