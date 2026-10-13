// SPDX-License-Identifier: AGPL-3.0-only
/**
 * When a page last changed, from git, for the sitemap's `<lastmod>`. A
 * shallow clone only knows its newest commit, which would date every page
 * to the latest deploy, so it reports nothing instead: no date is better
 * than a wrong one.
 */
import { execFileSync } from 'node:child_process';

function git(args: string[], cwd: string): string {
	return execFileSync('git', args, {
		cwd,
		encoding: 'utf8',
		stdio: ['ignore', 'pipe', 'ignore'],
	}).trim();
}

/** ISO date of the newest commit touching any of `paths`, or undefined. */
export function lastModified(paths: readonly string[], cwd = process.cwd()): string | undefined {
	try {
		if (git(['rev-parse', '--is-shallow-repository'], cwd) !== 'false') return undefined;
		const date = git(['log', '-1', '--format=%cI', '--', ...paths], cwd);
		return date || undefined;
	} catch {
		return undefined;
	}
}
