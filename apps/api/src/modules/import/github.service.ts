// SPDX-License-Identifier: AGPL-3.0-only
/**
 * "Add from GitHub" (plan 16 §8): the API scans a **public** repository and
 * returns what it found — skills, plugins, marketplaces, instruction files,
 * MCP manifests — with their file contents. The browser then encrypts and
 * commits the chosen ones; the server only proxied public data.
 *
 * SSRF-safe by construction: requests go only to fixed GitHub hosts and the
 * user controls nothing but the (validated) `owner/name` and ref.
 */
import { AppError } from '../../http/app-error';

const API = 'https://api.github.com';
const RAW = 'https://raw.githubusercontent.com';
const CACHE_TTL_MS = 10 * 60_000;
const MAX_FILE_BYTES = 1024 * 1024;
const MAX_ARTIFACT_BYTES = 20 * 1024 * 1024;
const MAX_ARTIFACT_FILES = 2000;
const MAX_TOTAL_FILES = 400;

export const REPO_PATTERN = /^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/;
export const REF_PATTERN = /^[A-Za-z0-9._/-]{1,200}$/;

export type ImportKind = 'skill' | 'plugin' | 'marketplace' | 'instructions' | 'mcp_server';

export interface ScannedFile {
	path: string;
	size: number;
	content_b64: string;
}

export interface ScannedItem {
	kind: ImportKind;
	/** Repository path of the artifact root (folder for skills/plugins, file otherwise). */
	path: string;
	name: string;
	files: ScannedFile[];
	/** True when size caps cut files from this item. */
	truncated: boolean;
}

export interface ScanResult {
	repo: string;
	ref: string;
	sha: string;
	items: ScannedItem[];
}

interface TreeEntry {
	path: string;
	type: 'blob' | 'tree' | 'commit';
	size?: number;
}

const INSTRUCTION_FILES = new Set([
	'AGENTS.md',
	'CLAUDE.md',
	'GEMINI.md',
	'.cursorrules',
	'.windsurfrules',
]);
const MCP_FILES = new Set(['.mcp.json', 'mcp.json']);

function basename(path: string): string {
	return path.split('/').at(-1) ?? path;
}

function dirname(path: string): string {
	const parts = path.split('/');
	parts.pop();
	return parts.join('/');
}

/** Pure detection over a repository tree; unit-tested. */
export function detectItems(
	tree: TreeEntry[],
): { kind: ImportKind; path: string; name: string; files: TreeEntry[] }[] {
	const blobs = tree.filter((entry) => entry.type === 'blob');
	const found: { kind: ImportKind; path: string; name: string; files: TreeEntry[] }[] = [];
	const under = (root: string) =>
		blobs.filter((entry) => (root === '' ? true : entry.path.startsWith(`${root}/`)));
	const repoName = 'repository';

	for (const entry of blobs) {
		const name = basename(entry.path);
		if (name === 'SKILL.md') {
			const root = dirname(entry.path);
			found.push({
				kind: 'skill',
				path: root || '.',
				name: basename(root) || repoName,
				files: under(root),
			});
		} else if (entry.path.endsWith('.claude-plugin/plugin.json')) {
			const root = dirname(dirname(entry.path));
			found.push({
				kind: 'plugin',
				path: root || '.',
				name: basename(root) || repoName,
				files: under(root),
			});
		} else if (entry.path.endsWith('.claude-plugin/marketplace.json')) {
			found.push({
				kind: 'marketplace',
				path: entry.path,
				name: basename(dirname(dirname(entry.path))) || repoName,
				files: [entry],
			});
		} else if (INSTRUCTION_FILES.has(name)) {
			found.push({ kind: 'instructions', path: entry.path, name, files: [entry] });
		} else if (MCP_FILES.has(name)) {
			found.push({
				kind: 'mcp_server',
				path: entry.path,
				name: basename(dirname(entry.path)) || repoName,
				files: [entry],
			});
		}
	}
	// A skill inside a plugin is part of that plugin, not a separate item.
	const pluginRoots = found.filter((item) => item.kind === 'plugin').map((item) => item.path);
	return found
		.filter(
			(item) =>
				item.kind !== 'skill' ||
				!pluginRoots.some(
					(root) =>
						root === '.' || item.path === root || item.path.startsWith(`${root}/`),
				),
		)
		.sort((a, b) => a.path.localeCompare(b.path));
}

export class GithubImporter {
	private readonly cache = new Map<string, { expires: number; result: ScanResult }>();

	constructor(private readonly http: typeof fetch = fetch) {}

	private async json<T>(url: string): Promise<T> {
		const response = await this.http(url, {
			headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'skillpouch-import' },
			signal: AbortSignal.timeout(10_000),
		});
		if (response.status === 404)
			throw new AppError('not_found', {
				reason: 'repository or ref not found (public repos only)',
			});
		if (!response.ok) throw new AppError('upstream_unavailable', { status: response.status });
		return (await response.json()) as T;
	}

	private async raw(repo: string, sha: string, path: string): Promise<Buffer> {
		const url = `${RAW}/${repo}/${sha}/${path.split('/').map(encodeURIComponent).join('/')}`;
		const response = await this.http(url, { signal: AbortSignal.timeout(10_000) });
		if (!response.ok)
			throw new AppError('upstream_unavailable', { status: response.status, path });
		return Buffer.from(await response.arrayBuffer());
	}

	async scan(repo: string, ref: string | undefined): Promise<ScanResult> {
		if (!REPO_PATTERN.test(repo) || repo.includes('..'))
			throw new AppError('validation_failed', { reason: 'repo must be owner/name' });
		if (ref !== undefined && (!REF_PATTERN.test(ref) || ref.includes('..'))) {
			throw new AppError('validation_failed', { reason: 'invalid ref' });
		}
		const resolvedRef =
			ref ??
			(await this.json<{ default_branch: string }>(`${API}/repos/${repo}`)).default_branch;
		const commit = await this.json<{ sha: string }>(
			`${API}/repos/${repo}/commits/${encodeURIComponent(resolvedRef)}`,
		);
		const key = `${repo.toLowerCase()}@${commit.sha}`;
		const cached = this.cache.get(key);
		if (cached && cached.expires > Date.now()) return cached.result;

		const tree = await this.json<{ tree: TreeEntry[]; truncated?: boolean }>(
			`${API}/repos/${repo}/git/trees/${commit.sha}?recursive=1`,
		);
		let budget = MAX_TOTAL_FILES;
		const items: ScannedItem[] = [];
		for (const item of detectItems(tree.tree)) {
			const files: ScannedFile[] = [];
			let bytes = 0;
			let truncated = tree.truncated === true;
			for (const entry of item.files) {
				const size = entry.size ?? 0;
				if (
					size > MAX_FILE_BYTES ||
					bytes + size > MAX_ARTIFACT_BYTES ||
					files.length >= MAX_ARTIFACT_FILES ||
					budget <= 0
				) {
					truncated = true;
					continue;
				}
				const content = await this.raw(repo, commit.sha, entry.path);
				bytes += content.length;
				budget -= 1;
				files.push({
					path: entry.path,
					size: content.length,
					content_b64: content.toString('base64'),
				});
			}
			items.push({ kind: item.kind, path: item.path, name: item.name, files, truncated });
		}
		const result = { repo, ref: resolvedRef, sha: commit.sha, items };
		this.cache.set(key, { expires: Date.now() + CACHE_TTL_MS, result });
		return result;
	}
}
