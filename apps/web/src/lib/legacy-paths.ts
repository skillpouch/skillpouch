// SPDX-License-Identifier: AGPL-3.0-only
/** Old `/app/...` links: `/app` → `/pouches`, `/app/p/<id>/...` → `/pouches/<id>/...`, `/app/account/...` → `/account/...`. */
export function fromLegacyPath(path: string): string | null {
	if (path !== '/app' && !path.startsWith('/app/')) return null;
	const rest = path.slice('/app'.length).replace(/^\/$/, '');
	if (!rest) return '/pouches';
	if (rest === '/p' || rest.startsWith('/p/')) return `/pouches${rest.slice(2)}`;
	return rest;
}
