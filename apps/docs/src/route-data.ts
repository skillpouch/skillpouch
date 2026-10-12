// SPDX-License-Identifier: AGPL-3.0-only
/** Starlight route middleware: keeps generated endpoint pages out of search results. */
import { defineRouteMiddleware } from '@astrojs/starlight/route-data';
import { isApiOperation } from './seo';

export const onRequest = defineRouteMiddleware((context) => {
	if (!isApiOperation(context.url.pathname)) return;
	context.locals.starlightRoute.head.push({
		tag: 'meta',
		attrs: { name: 'robots', content: 'noindex, follow' },
	});
});
