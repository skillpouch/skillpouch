// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Checks a built static site the way a crawler sees it: every indexable page
 * has a title, a description, `lang`, one canonical pointing at itself and
 * valid JSON-LD; internal links lead to pages that exist; the sitemap lists
 * exactly the indexable pages; robots.txt points at the sitemap and doesn't
 * shut crawlers out. Used for skillpouch.net and docs.skillpouch.net.
 *
 *   node apps/site/scripts/check-dist.mjs <dist> <origin>
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const attr = (tag, name) => tag.match(new RegExp(`\\s${name}="([^"]*)"`, 'i'))?.[1];
const tags = (html, name) => html.match(new RegExp(`<${name}\\b[^>]*>`, 'gi')) ?? [];
const decode = (text) =>
	text
		.replace(/&amp;/g, '&')
		.replace(/&#39;|&#x27;/g, "'")
		.replace(/&quot;/g, '"');

/** `index.html` → `/`, `terms/index.html` → `/terms/`, `404.html` → `/404.html`. */
export function urlPath(file) {
	const path = `/${file.split(sep).join('/')}`;
	return path.endsWith('/index.html') ? path.slice(0, -'index.html'.length) : path;
}

export function isNoindex(html) {
	return tags(html, 'meta').some(
		(tag) =>
			attr(tag, 'name')?.toLowerCase() === 'robots' &&
			/noindex/i.test(attr(tag, 'content') ?? ''),
	);
}

/** What a crawler reads from one page. */
export function readPage(html) {
	const meta = (name) =>
		tags(html, 'meta').find((tag) => (attr(tag, 'name') ?? attr(tag, 'property')) === name);
	return {
		title: decode(html.match(/<title>([^<]*)<\/title>/i)?.[1]?.trim() ?? ''),
		description: decode(attr(meta('description') ?? '', 'content') ?? ''),
		lang: attr(html.match(/<html\b[^>]*>/i)?.[0] ?? '', 'lang'),
		canonicals: tags(html, 'link')
			.filter((tag) => attr(tag, 'rel') === 'canonical')
			.map((tag) => attr(tag, 'href')),
		jsonLd: [
			...html.matchAll(
				/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi,
			),
		].map((match) => match[1]),
		links: tags(html, 'a')
			.map((tag) => attr(tag, 'href'))
			.filter((href) => href !== undefined)
			.map(decode),
		noindex: isNoindex(html),
	};
}

/** Problems with one indexable page at `path`. */
export function checkPage(page, path, origin) {
	const errors = [];
	const expected = new URL(path, origin).href;
	if (!page.title) errors.push('no <title>');
	if (!page.description) errors.push('no meta description');
	if (page.lang !== 'en') errors.push(`<html lang> is ${page.lang ?? 'missing'}`);
	if (page.canonicals.length !== 1) errors.push(`${page.canonicals.length} canonical links`);
	else if (page.canonicals[0] !== expected)
		errors.push(`canonical ${page.canonicals[0]} is not ${expected}`);
	for (const body of page.jsonLd) {
		try {
			const data = JSON.parse(body);
			if (data['@context'] !== 'https://schema.org')
				errors.push('JSON-LD without schema.org context');
		} catch {
			errors.push('JSON-LD does not parse');
		}
	}
	return errors;
}

/** `<loc>`s of a sitemap or sitemap index. */
export function sitemapLocs(xml) {
	return [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => decode(match[1]));
}

function walk(dir, root = dir) {
	return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
		const path = join(dir, entry.name);
		return entry.isDirectory() ? walk(path, root) : [relative(root, path)];
	});
}

/** Cloudflare Pages `_redirects` sources, as path prefixes. */
function redirectSources(dist) {
	const file = join(dist, '_redirects');
	if (!existsSync(file)) return [];
	return readFileSync(file, 'utf8')
		.split('\n')
		.filter((line) => line.trim() && !line.startsWith('#'))
		.map((line) => line.split(/\s+/)[0].replace(/\*$/, ''));
}

/** Whether `path` on this host is served by a file in `dist` (or a redirect). */
function resolves(dist, path, redirects) {
	const clean = decodeURIComponent(path.split(/[?#]/)[0]);
	if (clean === '' || clean === '/') return existsSync(join(dist, 'index.html'));
	if (
		redirects.some(
			(source) => clean === source || (source.endsWith('/') && clean.startsWith(source)),
		)
	)
		return true;
	if (clean.endsWith('/')) return existsSync(join(dist, clean, 'index.html'));
	return existsSync(join(dist, clean));
}

/** Every problem found in a built site, as readable lines. */
export function checkSite(dist, origin) {
	const errors = [];
	const host = new URL(origin).host;
	const redirects = redirectSources(dist);
	const files = walk(dist)
		.filter((file) => file.endsWith('.html'))
		.sort();
	const indexable = new Map();
	const titles = new Map();

	for (const file of files) {
		const path = urlPath(file);
		const page = readPage(readFileSync(join(dist, file), 'utf8'));
		if (path === '/404.html') {
			if (!page.noindex) errors.push('/404.html: the not-found page should be noindex');
		} else if (!page.noindex) {
			indexable.set(path, page);
			for (const error of checkPage(page, path, origin)) errors.push(`${path}: ${error}`);
			if (titles.has(page.title))
				errors.push(`${path}: same title as ${titles.get(page.title)}`);
			else titles.set(page.title, path);
		}
		for (const href of page.links) {
			let target;
			if (href.startsWith('/') && !href.startsWith('//')) target = href;
			else if (href.startsWith(origin))
				target = new URL(href).pathname + new URL(href).search;
			else continue;
			if (!resolves(dist, target, redirects)) errors.push(`${path}: broken link ${href}`);
		}
	}

	const robotsFile = join(dist, 'robots.txt');
	const robots = existsSync(robotsFile) ? readFileSync(robotsFile, 'utf8') : '';
	if (!robots) errors.push('robots.txt is missing');
	if (/^Disallow:\s*\/\s*$/im.test(robots)) errors.push('robots.txt disallows the whole site');
	const sitemapUrl = robots.match(/^Sitemap:\s*(\S+)/im)?.[1];
	if (!sitemapUrl) errors.push('robots.txt has no Sitemap line');

	const pending = sitemapUrl ? [sitemapUrl] : [];
	const listed = new Set();
	while (pending.length) {
		const url = pending.shift();
		if (new URL(url).host !== host) {
			errors.push(`sitemap ${url} is on another host`);
			continue;
		}
		const file = join(dist, new URL(url).pathname);
		if (!existsSync(file)) {
			errors.push(`sitemap ${url} does not exist`);
			continue;
		}
		for (const loc of sitemapLocs(readFileSync(file, 'utf8'))) {
			if (loc.endsWith('.xml')) pending.push(loc);
			else listed.add(loc);
		}
	}
	for (const loc of listed) {
		const { host: locHost, pathname } = new URL(loc);
		if (locHost !== host) errors.push(`sitemap lists ${loc}, on another host`);
		else if (!indexable.has(pathname))
			errors.push(`sitemap lists ${loc}, which is not an indexable page`);
	}
	for (const path of indexable.keys()) {
		if (!listed.has(new URL(path, origin).href))
			errors.push(`${path}: indexable but not in the sitemap`);
	}
	if (indexable.size === 0) errors.push('no indexable pages');
	return errors;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	const [dist, origin] = process.argv.slice(2);
	if (!dist || !origin) {
		console.error('usage: check-dist.mjs <dist> <origin>');
		process.exit(2);
	}
	const errors = checkSite(dist, origin);
	for (const error of errors) console.error(`✗ ${error}`);
	if (errors.length) process.exit(1);
	console.log(`✓ ${origin}: pages, links, sitemap and robots.txt check out`);
}
