// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Starlight route middleware: keeps generated endpoint pages out of search
 * results, and describes every guide to search engines as a TechArticle
 * with its breadcrumb trail.
 */
import { defineRouteMiddleware } from '@astrojs/starlight/route-data';
import { breadcrumbs, guideJsonLd, isApiOperation, sidebarLabels } from './seo';

export const onRequest = defineRouteMiddleware((context) => {
	const route = context.locals.starlightRoute;
	const path = context.url.pathname;
	// Starlight's not-found page renders at `/404.html` with a 404 status.
	if (isApiOperation(path) || route.id === '404') {
		route.head.push({ tag: 'meta', attrs: { name: 'robots', content: 'noindex, follow' } });
		return;
	}
	if (route.entry.data.template === 'splash') return;
	const { title, description } = route.entry.data;
	route.head.push({
		tag: 'script',
		attrs: { type: 'application/ld+json' },
		content: guideJsonLd({
			path,
			title,
			description,
			crumbs: breadcrumbs(path, title, sidebarLabels(route.sidebar)),
		}),
	});
});
