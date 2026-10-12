// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Reads GitHub repositories for "Add from GitHub" and marketplaces: the API
 * finds skills, agents, commands, plugins, instruction files and MCP
 * manifests, and returns their file contents. The browser then encrypts and
 * commits the chosen ones; the server only proxies repository data.
 *
 * Public repos are read anonymously (or with `GITHUB_PUBLIC_TOKEN` for a
 * higher rate limit). Private repos need a `GithubAuth`: a GitHub App
 * installation token plus a cache scope, so one account never sees another
 * account's cached private trees.
 *
 * SSRF-safe by construction: requests go only to fixed GitHub hosts and the
 * user controls nothing but the (validated) `owner/name`, ref and paths taken
 * from the repository's own tree.
 */
import { AppError } from '../../http/app-error';
import { mapLimited } from '../../lib/map-limited';

const API = 'https://api.github.com';
const RAW = 'https://raw.githubusercontent.com';
const CACHE_TTL_MS = 10 * 60_000;
/** How long a branch name keeps pointing at the commit we resolved. */
const REF_TTL_MS = 2 * 60_000;
const MAX_FILE_BYTES = 1024 * 1024;
const MAX_ARTIFACT_BYTES = 20 * 1024 * 1024;
const MAX_ARTIFACT_FILES = 2000;
const MAX_TOTAL_FILES = 400;
/** Everything one scan downloads, all items together. */
const MAX_SCAN_BYTES = 20 * 1024 * 1024;
/** All cached scans together; the oldest are evicted first. */
const MAX_CACHE_BYTES = 64 * 1024 * 1024;
const MAX_CACHED_SNAPSHOTS = 200;
/** Parallel file downloads per request. */
const DOWNLOAD_CONCURRENCY = 16;

export const REPO_PATTERN = /^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/;
export const REF_PATTERN = /^[A-Za-z0-9._/-]{1,200}$/;

export type ImportKind =
	'skill' | 'agent' | 'command' | 'plugin' | 'marketplace' | 'instructions' | 'mcp_server';

export const IMPORT_KINDS = [
	'skill',
	'agent',
	'command',
	'plugin',
	'marketplace',
	'instructions',
	'mcp_server',
] as const satisfies readonly ImportKind[];

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

export interface TreeEntry {
	path: string;
	type: 'blob' | 'tree' | 'commit';
	size?: number;
}

export interface DetectedItem {
	kind: ImportKind;
	path: string;
	name: string;
	files: TreeEntry[];
	/**
	 * A plugin's other files: taken only when its manifest or hook files point
	 * at them, so other assistants' copies, docs and tests stay behind.
	 */
	extra?: TreeEntry[];
}

/** One commit of a repository: its tree and what was detected in it. */
export interface RepoSnapshot {
	repo: string;
	ref: string;
	sha: string;
	private: boolean;
	/** GitHub cut the tree short (very large repositories). */
	truncated: boolean;
	items: DetectedItem[];
}

/** Credentials for a private repository. */
export interface GithubAuth {
	token: string;
	/** Cache partition: results fetched with this token are never served to another scope. */
	scope: string;
}

const INSTRUCTION_FILES = new Set([
	'AGENTS.md',
	'CLAUDE.md',
	'GEMINI.md',
	'.cursorrules',
	'.windsurfrules',
]);
const MCP_FILES = new Set(['.mcp.json', 'mcp.json']);
/** Folders whose markdown files are one agent / one command each (Claude Code layout). */
const SINGLE_FILE_FOLDERS: Record<string, ImportKind> = { agents: 'agent', commands: 'command' };
/**
 * What a Claude Code plugin is made of (code.claude.com/docs/en/plugins-reference).
 * Hook scripts elsewhere, such as `scripts/`, come in when a hook points at them.
 */
const PLUGIN_FOLDERS = new Set([
	'.claude-plugin',
	'skills',
	'hooks',
	'monitors',
	'output-styles',
	'themes',
	'workflows',
	'bin',
]);
/** Only markdown in these: other assistants' command formats (`*.toml`) stay behind. */
const PLUGIN_MARKDOWN_FOLDERS = new Set(['agents', 'commands']);
const PLUGIN_FILES = new Set(['settings.json', '.mcp.json', '.lsp.json', 'SKILL.md']);
const PLUGIN_NOTICES = /^(?:readme|license|licence|copying|notice)(?:\.[a-z]+)?$/i;
const PLUGIN_ROOT_REFERENCE =
	/CLAUDE_PLUGIN_ROOT\}?["']*[/\\]+([A-Za-z0-9._@+-]+(?:\/[A-Za-z0-9._@+-]+)*)/g;

/** Whether a path inside a plugin (relative to its root) is part of the plugin itself. */
export function inPluginLayout(path: string): boolean {
	const [top, ...rest] = path.split('/');
	if (rest.length === 0) return PLUGIN_FILES.has(top!) || PLUGIN_NOTICES.test(top!);
	if (PLUGIN_MARKDOWN_FOLDERS.has(top!)) return path.toLowerCase().endsWith('.md');
	return PLUGIN_FOLDERS.has(top!);
}

/**
 * Paths (relative to the plugin root) that a plugin's own JSON files point
 * at: custom component paths in `plugin.json` (`"./…"`) and the files that
 * hook or server commands run from `${CLAUDE_PLUGIN_ROOT}`, with their folder.
 */
export function pluginReferences(files: readonly { path: string; content: string }[]): string[] {
	const found = new Set<string>();
	const add = (path: string) => {
		const clean = path.replace(/^\.\//, '').replace(/\/+$/, '');
		if (clean && clean !== '.' && !clean.split('/').includes('..')) found.add(clean);
	};
	const walk = (value: unknown): void => {
		if (typeof value === 'string') {
			if (value.startsWith('./')) add(value);
			for (const match of value.matchAll(PLUGIN_ROOT_REFERENCE)) {
				const path = match[1]!;
				add(path.includes('/') ? dirname(path) : path);
			}
		} else if (Array.isArray(value)) {
			value.forEach(walk);
		} else if (value && typeof value === 'object') {
			Object.values(value).forEach(walk);
		}
	};
	for (const file of files) {
		if (!file.path.endsWith('.json')) continue;
		try {
			walk(JSON.parse(file.content));
		} catch {
			// Not JSON after all: it points at nothing we can trust.
		}
	}
	return [...found].sort();
}

function basename(path: string): string {
	return path.split('/').at(-1) ?? path;
}

function dirname(path: string): string {
	const parts = path.split('/');
	parts.pop();
	return parts.join('/');
}

export function validateRepo(repo: string): void {
	if (!REPO_PATTERN.test(repo) || repo.includes('..'))
		throw new AppError('validation_failed', { reason: 'repo must be owner/name' });
}

function validateRef(ref: string | undefined): void {
	if (ref !== undefined && (!REF_PATTERN.test(ref) || ref.includes('..'))) {
		throw new AppError('validation_failed', { reason: 'invalid ref' });
	}
}

/** Pure detection over a repository tree; unit-tested. */
export function detectItems(tree: TreeEntry[]): DetectedItem[] {
	const blobs = tree.filter((entry) => entry.type === 'blob');
	const found: DetectedItem[] = [];
	const under = (root: string) =>
		blobs.filter((entry) => (root === '' ? true : entry.path.startsWith(`${root}/`)));
	const repoName = 'repository';

	for (const entry of blobs) {
		const name = basename(entry.path);
		const folderKind = SINGLE_FILE_FOLDERS[basename(dirname(entry.path))];
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
			const item = { path: root || '.' };
			const files = under(root);
			const isLayout = (file: TreeEntry) => inPluginLayout(itemRelativePath(item, file.path));
			found.push({
				kind: 'plugin',
				path: item.path,
				name: basename(root) || repoName,
				files: files.filter(isLayout),
				extra: files.filter((file) => !isLayout(file)),
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
		} else if (folderKind && name.endsWith('.md') && name.toLowerCase() !== 'readme.md') {
			found.push({
				kind: folderKind,
				path: entry.path,
				name: name.slice(0, -'.md'.length),
				files: [entry],
			});
		}
	}
	// A skill, agent or command inside a plugin is part of that plugin, and an
	// instructions or MCP file inside a skill or plugin folder belongs to it.
	const pluginRoots = found.filter((item) => item.kind === 'plugin').map((item) => item.path);
	const folderRoots = found
		.filter((item) => item.kind === 'plugin' || item.kind === 'skill')
		.map((item) => item.path)
		.filter((root) => root !== '.');
	const partOfPlugin = new Set<ImportKind>(['skill', 'agent', 'command']);
	const partOfFolder = new Set<ImportKind>(['instructions', 'mcp_server']);
	const inside = (path: string, root: string) =>
		root === '.' || path === root || path.startsWith(`${root}/`);
	return found
		.filter((item) => {
			if (partOfPlugin.has(item.kind)) {
				return !pluginRoots.some((root) => inside(item.path, root));
			}
			if (partOfFolder.has(item.kind)) {
				return !folderRoots.some((root) => item.path.startsWith(`${root}/`));
			}
			return true;
		})
		.sort((a, b) => a.path.localeCompare(b.path));
}

/** The file path relative to an item's root, as stored in a pouch. */
export function itemRelativePath(item: Pick<DetectedItem, 'path'>, path: string): string {
	if (item.path === path) return basename(path);
	if (item.path === '.') return path;
	return path.slice(item.path.length + 1);
}

/**
 * The files of one item that fit the per-item caps (and the shared `budget`
 * of a whole scan), judged by the sizes in the tree before downloading.
 */
function pickFiles(
	entries: readonly TreeEntry[],
	...budgets: Budget[]
): { entries: TreeEntry[]; truncated: boolean } {
	const picked: TreeEntry[] = [];
	let truncated = false;
	for (const entry of entries) {
		const size = entry.size ?? 0;
		if (
			size > MAX_FILE_BYTES ||
			budgets.some((budget) => budget.files <= 0 || size > budget.bytes)
		) {
			truncated = true;
			continue;
		}
		picked.push(entry);
		for (const budget of budgets) {
			budget.files -= 1;
			budget.bytes -= size;
		}
	}
	return { entries: picked, truncated };
}

interface Budget {
	files: number;
	bytes: number;
}

const itemBudget = (): Budget => ({ files: MAX_ARTIFACT_FILES, bytes: MAX_ARTIFACT_BYTES });

/** Rounds of following references: a manifest can name a hook file that names a script. */
const REFERENCE_ROUNDS = 3;

export class GithubImporter {
	/** Insertion order is recency order: a hit re-inserts the entry. */
	private readonly cache = new Map<
		string,
		{ expires: number; bytes: number; result: ScanResult }
	>();
	private cacheBytes = 0;
	private readonly snapshots = new Map<string, { expires: number; snapshot: RepoSnapshot }>();
	private readonly refs = new Map<string, { expires: number; sha: string; ref: string }>();
	private readonly refreshing = new Set<string>();

	constructor(
		private readonly http: typeof fetch = fetch,
		private readonly publicToken?: string,
	) {}

	private headers(auth: GithubAuth | undefined): Record<string, string> {
		const token = auth?.token ?? this.publicToken;
		return {
			Accept: 'application/vnd.github+json',
			'User-Agent': 'skillpouch-import',
			...(token ? { Authorization: `Bearer ${token}` } : {}),
		};
	}

	private async json<T>(url: string, auth?: GithubAuth): Promise<T> {
		const response = await this.http(url, {
			headers: this.headers(auth),
			signal: AbortSignal.timeout(10_000),
		});
		if (response.status === 404)
			throw new AppError('not_found', {
				reason: auth
					? 'repository or ref not found, or SkillPouch has no access to it'
					: 'repository or ref not found (public repos only)',
			});
		if (!response.ok) throw new AppError('upstream_unavailable', { status: response.status });
		return (await response.json()) as T;
	}

	/** One file at a commit: the raw host for public repos, the contents API with a token. */
	async file(repo: string, sha: string, path: string, auth?: GithubAuth): Promise<Buffer> {
		const encoded = path.split('/').map(encodeURIComponent).join('/');
		const response = auth
			? await this.http(`${API}/repos/${repo}/contents/${encoded}?ref=${sha}`, {
					headers: { ...this.headers(auth), Accept: 'application/vnd.github.raw' },
					signal: AbortSignal.timeout(10_000),
				})
			: await this.http(`${RAW}/${repo}/${sha}/${encoded}`, {
					signal: AbortSignal.timeout(10_000),
				});
		if (!response.ok)
			throw new AppError('upstream_unavailable', { status: response.status, path });
		return Buffer.from(await response.arrayBuffer());
	}

	private async resolve(
		repo: string,
		ref: string | undefined,
		auth: GithubAuth | undefined,
	): Promise<{ ref: string; sha: string; private: boolean }> {
		const key = `${auth?.scope ?? 'public'}|${repo.toLowerCase()}|${ref ?? ''}`;
		const known = this.refs.get(key);
		if (known) {
			// An expired branch keeps its last commit while a lookup runs in the
			// background, so a browsing user never waits on GitHub twice.
			if (known.expires <= Date.now() && !this.refreshing.has(key)) {
				this.refreshing.add(key);
				this.lookup(key, repo, ref, auth)
					.catch(() => this.refs.delete(key))
					.finally(() => this.refreshing.delete(key));
			}
			return { ref: known.ref, sha: known.sha, private: auth !== undefined };
		}
		return this.lookup(key, repo, ref, auth);
	}

	private async lookup(
		key: string,
		repo: string,
		ref: string | undefined,
		auth: GithubAuth | undefined,
	): Promise<{ ref: string; sha: string; private: boolean }> {
		let resolvedRef = ref;
		let isPrivate = false;
		if (resolvedRef === undefined || auth) {
			const info = await this.json<{ default_branch: string; private?: boolean }>(
				`${API}/repos/${repo}`,
				auth,
			);
			resolvedRef ??= info.default_branch;
			isPrivate = info.private === true;
		}
		const commit = await this.json<{ sha: string }>(
			`${API}/repos/${repo}/commits/${encodeURIComponent(resolvedRef)}`,
			auth,
		);
		this.refs.set(key, { expires: Date.now() + REF_TTL_MS, sha: commit.sha, ref: resolvedRef });
		return { ref: resolvedRef, sha: commit.sha, private: isPrivate };
	}

	/** The repository's tree and detected items, without file contents. */
	async snapshot(repo: string, ref?: string, auth?: GithubAuth): Promise<RepoSnapshot> {
		validateRepo(repo);
		validateRef(ref);
		const head = await this.resolve(repo, ref, auth);
		const key = `${auth?.scope ?? 'public'}|${repo.toLowerCase()}@${head.sha}`;
		const cached = this.snapshots.get(key);
		if (cached && cached.expires > Date.now()) return cached.snapshot;

		const tree = await this.json<{ tree: TreeEntry[]; truncated?: boolean }>(
			`${API}/repos/${repo}/git/trees/${head.sha}?recursive=1`,
			auth,
		);
		const snapshot: RepoSnapshot = {
			repo,
			ref: head.ref,
			sha: head.sha,
			private: head.private,
			truncated: tree.truncated === true,
			items: detectItems(tree.tree),
		};
		this.snapshots.delete(key);
		this.snapshots.set(key, { expires: Date.now() + CACHE_TTL_MS, snapshot });
		for (const oldKey of this.snapshots.keys()) {
			if (this.snapshots.size <= MAX_CACHED_SNAPSHOTS) break;
			this.snapshots.delete(oldKey);
		}
		return snapshot;
	}

	/** Downloads one detected item's files, within the per-item size caps. */
	async readItem(
		snapshot: RepoSnapshot,
		item: DetectedItem,
		auth?: GithubAuth,
	): Promise<{ files: ScannedFile[]; truncated: boolean }> {
		const { files, truncated } = await this.fetchItem(snapshot.repo, snapshot.sha, item, auth);
		return {
			files: files.map((file) => ({ ...file, path: itemRelativePath(item, file.path) })),
			truncated: snapshot.truncated || truncated,
		};
	}

	/** An item's files (repository paths), and for a plugin the extra files it points at. */
	private async fetchItem(
		repo: string,
		sha: string,
		item: DetectedItem,
		auth?: GithubAuth,
		scanBudget?: Budget,
	): Promise<{ files: ScannedFile[]; truncated: boolean }> {
		const budgets = [itemBudget(), ...(scanBudget ? [scanBudget] : [])];
		const picked = pickFiles(item.files, ...budgets);
		const files = await this.download(repo, sha, picked.entries, auth);
		const more = await this.followReferences(repo, sha, item, files, budgets, auth);
		return { files: [...files, ...more.files], truncated: picked.truncated || more.truncated };
	}

	/** The files of `item.extra` that the already downloaded `files` point at. */
	private async followReferences(
		repo: string,
		sha: string,
		item: DetectedItem,
		downloaded: ScannedFile[],
		budgets: Budget[],
		auth?: GithubAuth,
	): Promise<{ files: ScannedFile[]; truncated: boolean }> {
		const files: ScannedFile[] = [];
		let truncated = false;
		let rest = item.extra ?? [];
		let fresh = downloaded;
		for (let round = 0; round < REFERENCE_ROUNDS && rest.length > 0; round++) {
			const references = pluginReferences(
				fresh.map((file) => ({
					path: file.path,
					content: Buffer.from(file.content_b64, 'base64').toString('utf8'),
				})),
			);
			const wanted = rest.filter((entry) => {
				const path = itemRelativePath(item, entry.path);
				return references.some((ref) => path === ref || path.startsWith(`${ref}/`));
			});
			if (wanted.length === 0) break;
			rest = rest.filter((entry) => !wanted.includes(entry));
			const more = pickFiles(wanted, ...budgets);
			truncated ||= more.truncated;
			fresh = await this.download(repo, sha, more.entries, auth);
			files.push(...fresh);
		}
		return { files, truncated };
	}

	async scan(repo: string, ref: string | undefined): Promise<ScanResult> {
		validateRepo(repo);
		validateRef(ref);
		const resolvedRef =
			ref ??
			(await this.json<{ default_branch: string }>(`${API}/repos/${repo}`)).default_branch;
		const commit = await this.json<{ sha: string }>(
			`${API}/repos/${repo}/commits/${encodeURIComponent(resolvedRef)}`,
		);
		const key = `${repo.toLowerCase()}@${commit.sha}`;
		const cached = this.cache.get(key);
		if (cached) {
			this.cache.delete(key);
			if (cached.expires > Date.now()) {
				this.cache.set(key, cached);
				return cached.result;
			}
			this.cacheBytes -= cached.bytes;
		}

		const tree = await this.json<{ tree: TreeEntry[]; truncated?: boolean }>(
			`${API}/repos/${repo}/git/trees/${commit.sha}?recursive=1`,
		);
		const scanBudget = { files: MAX_TOTAL_FILES, bytes: MAX_SCAN_BYTES };
		const picks = detectItems(tree.tree).map((item) => {
			const budgets = [itemBudget(), scanBudget];
			return { item, budgets, picked: pickFiles(item.files, ...budgets) };
		});
		const all = await this.download(
			repo,
			commit.sha,
			picks.flatMap(({ picked }) => picked.entries),
		);
		let offset = 0;
		let scanBytes = 0;
		const items: ScannedItem[] = [];
		for (const { item, budgets, picked } of picks) {
			const own = all.slice(offset, (offset += picked.entries.length));
			const more = await this.followReferences(repo, commit.sha, item, own, budgets);
			const files = [...own, ...more.files];
			scanBytes += files.reduce((sum, file) => sum + file.size, 0);
			items.push({
				kind: item.kind,
				path: item.path,
				name: item.name,
				files,
				truncated: tree.truncated === true || picked.truncated || more.truncated,
			});
		}
		const result = { repo, ref: resolvedRef, sha: commit.sha, items };
		this.remember(key, result, scanBytes);
		return result;
	}

	private download(
		repo: string,
		sha: string,
		entries: readonly TreeEntry[],
		auth?: GithubAuth,
	): Promise<ScannedFile[]> {
		return mapLimited(entries, DOWNLOAD_CONCURRENCY, async (entry) => {
			const content = await this.file(repo, sha, entry.path, auth);
			return {
				path: entry.path,
				size: content.length,
				content_b64: content.toString('base64'),
			};
		});
	}

	/** Cached bytes right now (for tests and metrics). */
	get cachedBytes(): number {
		return this.cacheBytes;
	}

	private remember(key: string, result: ScanResult, bytes: number): void {
		// base64 in memory is 4/3 of the raw size.
		const cost = Math.ceil((bytes * 4) / 3) + 1024;
		if (cost > MAX_CACHE_BYTES) return;
		const now = Date.now();
		for (const [oldKey, entry] of this.cache) {
			if (this.cacheBytes + cost <= MAX_CACHE_BYTES && entry.expires > now) break;
			this.cache.delete(oldKey);
			this.cacheBytes -= entry.bytes;
		}
		this.cache.set(key, { expires: now + CACHE_TTL_MS, bytes: cost, result });
		this.cacheBytes += cost;
	}
}
