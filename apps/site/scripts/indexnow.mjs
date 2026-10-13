// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Tells IndexNow search engines (Bing, Yandex and the others that share
 * api.indexnow.org; not Google) which pages a deploy changed. Runs after a
 * deploy from main; a failure here never fails the deploy.
 *
 *   node apps/site/scripts/indexnow.mjs <dist> <origin> <app dir> <before sha>
 *
 * The key is public by design: it is served at `/<key>.txt` to prove the
 * host is ours. See docs.skillpouch.net/development/discoverability/.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sitemapLocs } from './check-dist.mjs';

export const INDEXNOW_KEY = '5bea17cecf5d7e2ab4dfcfe8940eae0a';
const ENDPOINT = 'https://api.indexnow.org/indexnow';

/** Every page URL in the built sitemap (following a sitemap index). */
export function builtUrls(dist) {
	const urls = [];
	const pending = ['sitemap-index.xml', 'sitemap.xml'].filter((file) =>
		existsSync(join(dist, file)),
	);
	while (pending.length) {
		for (const loc of sitemapLocs(readFileSync(join(dist, pending.shift()), 'utf8'))) {
			if (loc.endsWith('.xml')) pending.push(new URL(loc).pathname.slice(1));
			else urls.push(loc);
		}
	}
	return [...new Set(urls)];
}

/**
 * The URLs a change touched. A changed docs page maps to its own URL; any
 * other change to the app or the shared packages (layout, config, error
 * codes) may touch every page, so all of them go. Other apps don't count.
 */
export function changedUrls(urls, changedFiles, appDir, origin) {
	const contentDir = `${appDir}/src/content/docs/`;
	const touched = new Set();
	for (const file of changedFiles) {
		if (!file.startsWith(`${appDir}/`) && !file.startsWith('packages/')) continue;
		if (!file.startsWith(contentDir)) return urls;
		const slug = file
			.slice(contentDir.length)
			.replace(/\.mdx?$/, '')
			.replace(/(^|\/)index$/, '');
		touched.add(new URL(slug ? `/${slug}/` : '/', origin).href);
	}
	return urls.filter((url) => touched.has(url));
}

/** Files changed since `before`, or undefined when that commit isn't known. */
function changedSince(before) {
	if (!before || /^0+$/.test(before)) return undefined;
	try {
		return execFileSync('git', ['diff', '--name-only', before, 'HEAD'], { encoding: 'utf8' })
			.split('\n')
			.filter(Boolean);
	} catch {
		return undefined;
	}
}

export async function submit(origin, urlList, fetchImpl = fetch) {
	const host = new URL(origin).host;
	const response = await fetchImpl(ENDPOINT, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json; charset=utf-8' },
		body: JSON.stringify({
			host,
			key: INDEXNOW_KEY,
			keyLocation: `${origin}/${INDEXNOW_KEY}.txt`,
			urlList,
		}),
	});
	return response.status;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	const [dist, origin, appDir, before] = process.argv.slice(2);
	const urls = builtUrls(dist);
	const changed = changedSince(before);
	const list = changed ? changedUrls(urls, changed, appDir, origin) : urls;
	if (!list.length) {
		console.log('IndexNow: no indexable page changed');
	} else {
		const status = await submit(origin, list.slice(0, 10_000));
		// 200 and 202 (key check pending) both mean the list was received.
		console.log(`IndexNow: ${list.length} URL(s) for ${origin}, HTTP ${status}`);
		if (status !== 200 && status !== 202) process.exitCode = 1;
	}
}
