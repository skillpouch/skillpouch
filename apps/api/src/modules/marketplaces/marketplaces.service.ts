// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Marketplaces: places to pick skills, agents, MCP servers and more from.
 *
 *  - built in: skills.sh, the official MCP Registry and a few well-known
 *    GitHub repositories;
 *  - added by the account: any public GitHub repository, or a private one
 *    the account's GitHub App installation can read.
 *
 * The server lists items and returns one item's files; the browser encrypts
 * and saves what the user picks, exactly like "Add from GitHub".
 */
import { githubInstallations, marketplaces } from '@skillpouch/db';
import { eq, isNotNull } from 'drizzle-orm';
import type { Deps } from '../../deps';
import { AppError } from '../../http/app-error';
import { uuidv7 } from '../../lib/ids';
import { mapLimited } from '../../lib/map-limited';
import type { Principal } from '../../security/principal';
import { withTenantTx } from '../../security/tenant-tx';
import {
	REPO_PATTERN,
	validateRepo,
	type DetectedItem,
	type GithubAuth,
	type ImportKind,
	type RepoSnapshot,
	type ScannedFile,
} from '../import/github.service';
import { readFrontmatter } from './frontmatter';
import { shortServerName, toServerConfig, type RegistryServer } from './mcp-registry';
import { LEADERBOARD_PAGE, MIN_QUERY, type SkillsShHit } from './skills-sh';

const MAX_MARKETPLACES = 50;
/** Items whose description we fetch per repository; the rest list without one. */
const MAX_DESCRIBED = 300;
const DESCRIBE_CONCURRENCY = 16;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type MarketplaceSource = 'skills_sh' | 'mcp_registry' | 'github';
export type ItemKind = Exclude<ImportKind, 'marketplace'>;

export interface MarketplaceView {
	id: string;
	source: MarketplaceSource;
	name: string;
	description: string | null;
	repo: string | null;
	private: boolean;
	builtin: boolean;
	url: string;
	/** What it offers; the add dialog shows only marketplaces with the kind being added. */
	kinds: ItemKind[];
}

export interface MarketplaceItem {
	/** Opaque to clients: pass it back to read the item. */
	key: string;
	kind: ItemKind;
	name: string;
	description: string | null;
	/** `owner/name` of the GitHub repository the item comes from. */
	repo: string | null;
	installs: number | null;
}

export interface MarketplaceItemContent {
	kind: ItemKind;
	name: string;
	description: string | null;
	/** Paths relative to the item, as saved in a pouch. */
	files: ScannedFile[];
	truncated: boolean;
	url: string;
}

const REPO_KINDS: ItemKind[] = [
	'skill',
	'agent',
	'command',
	'instructions',
	'mcp_server',
	'plugin',
];

export const BUILTIN_MARKETPLACES: readonly MarketplaceView[] = [
	{
		id: 'skills-sh',
		source: 'skills_sh',
		name: 'skills.sh',
		description: 'The open directory of agent skills.',
		repo: null,
		private: false,
		builtin: true,
		url: 'https://skills.sh',
		kinds: ['skill'],
	},
	{
		id: 'mcp-registry',
		source: 'mcp_registry',
		name: 'MCP Registry',
		description: 'The official registry of MCP servers.',
		repo: null,
		private: false,
		builtin: true,
		url: 'https://registry.modelcontextprotocol.io',
		kinds: ['mcp_server'],
	},
	{
		id: 'anthropic-skills',
		source: 'github',
		name: 'Anthropic Skills',
		description: "Anthropic's skills for documents, design, development and more.",
		repo: 'anthropics/skills',
		private: false,
		builtin: true,
		url: 'https://github.com/anthropics/skills',
		kinds: ['skill'],
	},
	{
		id: 'vercel-agent-skills',
		source: 'github',
		name: 'Vercel Agent Skills',
		description: "Vercel's skills for React, Next.js and web development.",
		repo: 'vercel-labs/agent-skills',
		private: false,
		builtin: true,
		url: 'https://github.com/vercel-labs/agent-skills',
		kinds: ['skill'],
	},
];

type MarketplaceRow = typeof marketplaces.$inferSelect;

function toView(row: MarketplaceRow): MarketplaceView {
	return {
		id: row.id,
		source: 'github',
		name: row.repo,
		description: null,
		repo: row.repo,
		private: row.installationId !== null,
		builtin: false,
		url: `https://github.com/${row.repo}`,
		kinds: REPO_KINDS,
	};
}

/** `owner/name`, `https://github.com/owner/name(.git)(/tree/…)` → `owner/name`. */
export function normalizeRepo(input: string): string {
	const trimmed = input.trim();
	const match = /^(?:https?:\/\/)?(?:www\.)?github\.com\/([^/\s]+)\/([^/\s#?]+)/i.exec(trimmed);
	const repo = match ? `${match[1]}/${match[2]!.replace(/\.git$/i, '')}` : trimmed;
	validateRepo(repo);
	return repo;
}

function installationAuth(deps: Deps, installationId: number): Promise<GithubAuth> {
	const app = deps.githubApp;
	if (!app) throw new AppError('forbidden', { reason: 'GitHub App is not configured' });
	return app
		.installationToken(installationId)
		.then((token) => ({ token, scope: `installation:${installationId}` }));
}

export async function listMarketplaces(deps: Deps, principal: Principal) {
	const { rows, connections } = await withTenantTx(
		deps.db.app,
		principal.storageAccountId,
		async (tx) => ({
			rows: await tx.select().from(marketplaces).orderBy(marketplaces.createdAt),
			connections: await tx
				.select()
				.from(githubInstallations)
				.orderBy(githubInstallations.createdAt),
		}),
	);
	return {
		marketplaces: [...BUILTIN_MARKETPLACES, ...rows.map(toView)],
		github: {
			available: deps.githubApp !== null,
			install_url: deps.githubApp?.installUrl ?? null,
			authorize_url: deps.githubApp?.authorizeUrl ?? null,
			connections: connections.map((row) => ({
				installation_id: row.installationId,
				account: row.accountLogin,
				type: row.accountType,
			})),
		},
	};
}

interface OpenedRepo {
	snapshot: RepoSnapshot;
	auth: GithubAuth | undefined;
	/** Set when only the account's GitHub connection can read it. */
	installationId: number | null;
}

/** Reads `repo` through the account's GitHub connection, or as a public repository. */
async function openRepo(
	deps: Deps,
	installations: { installationId: number }[],
	repo: string,
): Promise<OpenedRepo> {
	for (const installation of installations) {
		try {
			const auth = await installationAuth(deps, installation.installationId);
			const snapshot = await deps.github.snapshot(repo, undefined, auth);
			return snapshot.private
				? { snapshot, auth, installationId: installation.installationId }
				: { snapshot, auth: undefined, installationId: null };
		} catch (error) {
			// This installation cannot read it (or GitHub refused); try the next one.
			if (!(error instanceof AppError)) throw error;
		}
	}
	const snapshot = await deps.github.snapshot(repo).catch((error: unknown) => {
		if (error instanceof AppError && error.code === 'not_found') {
			throw new AppError('not_found', {
				reason: deps.githubApp
					? 'repository not found — for a private repository, connect GitHub and give SkillPouch access to it'
					: 'repository not found (public repositories only)',
			});
		}
		throw error;
	});
	return { snapshot, auth: undefined, installationId: null };
}

async function openAccountRepo(deps: Deps, principal: Principal, input: string) {
	const repo = normalizeRepo(input);
	const { rows, installations } = await withTenantTx(
		deps.db.app,
		principal.storageAccountId,
		async (tx) => ({
			rows: await tx.select().from(marketplaces),
			installations: await tx.select().from(githubInstallations),
		}),
	);
	return { opened: await openRepo(deps, installations, repo), rows };
}

export interface RepositoryView {
	repo: string;
	private: boolean;
	url: string;
	/** The marketplace this repository already is, built in or added. */
	marketplace_id: string | null;
	/** It ships a marketplace manifest (`.claude-plugin/marketplace.json`). */
	has_manifest: boolean;
	items: MarketplaceItem[];
}

/** What a repository holds, without adding it as a marketplace. */
export async function inspectRepository(
	deps: Deps,
	principal: Principal,
	input: string,
): Promise<RepositoryView> {
	const { opened, rows } = await openAccountRepo(deps, principal, input);
	const { snapshot, auth } = opened;
	const same = (repo: string | null) => repo?.toLowerCase() === snapshot.repo.toLowerCase();
	const marketplace =
		BUILTIN_MARKETPLACES.find((entry) => same(entry.repo)) ??
		rows.find((row) => same(row.repo));
	const items = await describeRepo(deps, snapshot, auth);
	return {
		repo: snapshot.repo,
		private: snapshot.private,
		url: `https://github.com/${snapshot.repo}`,
		marketplace_id: marketplace?.id ?? null,
		has_manifest: snapshot.items.some((item) => item.kind === 'marketplace'),
		items: items.map(publicItem),
	};
}

/** One item of a repository, by the key `inspectRepository` listed. */
export async function readRepositoryItem(
	deps: Deps,
	principal: Principal,
	input: string,
	key: string,
): Promise<MarketplaceItemContent> {
	const { opened } = await openAccountRepo(deps, principal, input);
	return readRepoItem(deps, opened.snapshot, key, opened.auth);
}

export async function addMarketplace(
	deps: Deps,
	principal: Principal,
	input: string,
): Promise<MarketplaceView> {
	const repo = normalizeRepo(input);
	const builtin = BUILTIN_MARKETPLACES.find(
		(entry) => entry.repo?.toLowerCase() === repo.toLowerCase(),
	);
	if (builtin) return builtin;

	const { existing, installations } = await withTenantTx(
		deps.db.app,
		principal.storageAccountId,
		async (tx) => ({
			existing: await tx.select().from(marketplaces),
			installations: await tx.select().from(githubInstallations),
		}),
	);
	const same = existing.find((row) => row.repo.toLowerCase() === repo.toLowerCase());
	if (same) return toView(same);
	if (existing.length >= MAX_MARKETPLACES) {
		throw new AppError('validation_failed', {
			reason: `at most ${MAX_MARKETPLACES} marketplaces per account`,
		});
	}

	const { snapshot, installationId } = await openRepo(deps, installations, repo);
	const row: MarketplaceRow = {
		id: uuidv7(),
		storageAccountId: principal.storageAccountId,
		repo: snapshot.repo,
		installationId,
		createdAt: deps.now(),
	};
	await withTenantTx(deps.db.app, principal.storageAccountId, (tx) =>
		tx.insert(marketplaces).values(row).onConflictDoNothing(),
	);
	return toView(row);
}

export async function removeMarketplace(deps: Deps, principal: Principal, id: string) {
	if (BUILTIN_MARKETPLACES.some((entry) => entry.id === id)) {
		throw new AppError('validation_failed', { reason: 'built-in marketplaces stay' });
	}
	if (!UUID.test(id)) throw new AppError('not_found');
	const deleted = await withTenantTx(deps.db.app, principal.storageAccountId, (tx) =>
		tx.delete(marketplaces).where(eq(marketplaces.id, id)).returning({ id: marketplaces.id }),
	);
	if (deleted.length === 0) throw new AppError('not_found');
}

interface Resolved {
	view: MarketplaceView;
	auth: GithubAuth | undefined;
}

async function resolveMarketplace(deps: Deps, principal: Principal, id: string): Promise<Resolved> {
	const builtin = BUILTIN_MARKETPLACES.find((entry) => entry.id === id);
	if (builtin) return { view: builtin, auth: undefined };
	if (!UUID.test(id)) throw new AppError('not_found');
	const found = await withTenantTx(deps.db.app, principal.storageAccountId, async (tx) => {
		const [row] = await tx.select().from(marketplaces).where(eq(marketplaces.id, id));
		if (!row?.installationId) return { row, connected: false };
		const [installation] = await tx
			.select()
			.from(githubInstallations)
			.where(eq(githubInstallations.installationId, row.installationId));
		return { row, connected: installation !== undefined };
	});
	if (!found.row) throw new AppError('not_found');
	if (found.row.installationId === null) return { view: toView(found.row), auth: undefined };
	if (!found.connected) {
		throw new AppError('forbidden', { reason: 'connect GitHub again to read this repository' });
	}
	return {
		view: toView(found.row),
		auth: await installationAuth(deps, found.row.installationId),
	};
}

type McpServers = Record<string, Record<string, unknown>>;

/** `.mcp.json` (`mcpServers`) or VS Code's `mcp.json` (`servers`). */
export function mcpServersOf(content: Buffer): McpServers {
	try {
		const parsed = JSON.parse(content.toString('utf8')) as Record<string, unknown>;
		const servers = parsed.mcpServers ?? parsed.servers;
		if (!servers || typeof servers !== 'object' || Array.isArray(servers)) return {};
		return Object.fromEntries(
			Object.entries(servers as Record<string, unknown>).filter(
				(entry): entry is [string, Record<string, unknown>] =>
					typeof entry[1] === 'object' && entry[1] !== null && !Array.isArray(entry[1]),
			),
		);
	} catch {
		return {};
	}
}

function mainFile(item: DetectedItem): string | null {
	if (item.kind === 'skill') {
		const prefix = item.path === '.' ? '' : `${item.path}/`;
		return `${prefix}SKILL.md`;
	}
	if (item.kind === 'plugin') {
		const prefix = item.path === '.' ? '' : `${item.path}/`;
		return `${prefix}.claude-plugin/plugin.json`;
	}
	if (item.kind === 'agent' || item.kind === 'command' || item.kind === 'mcp_server') {
		return item.path;
	}
	return null;
}

interface Described extends MarketplaceItem {
	/** The skill's own `name`, when it differs from its folder. */
	declaredName: string | null;
}

const described = new WeakMap<RepoSnapshot, Promise<Described[]>>();

async function describeItem(
	deps: Deps,
	snapshot: RepoSnapshot,
	item: DetectedItem,
	auth: GithubAuth | undefined,
	fetchMain: boolean,
): Promise<Described[]> {
	const base = {
		key: item.path,
		kind: item.kind as ItemKind,
		name: item.name,
		description: null,
		repo: snapshot.repo,
		installs: null,
		declaredName: null,
	};
	const path = mainFile(item);
	if (!fetchMain || !path) return item.kind === 'mcp_server' ? [] : [base];
	let content: Buffer;
	try {
		content = await deps.github.file(snapshot.repo, snapshot.sha, path, auth);
	} catch {
		return item.kind === 'mcp_server' ? [] : [base];
	}
	if (item.kind === 'mcp_server') {
		return Object.entries(mcpServersOf(content)).map(([name, config]) => ({
			...base,
			key: `${item.path}#${name}`,
			name,
			description:
				typeof config.description === 'string'
					? config.description
					: typeof config.url === 'string'
						? config.url
						: [config.command, ...(Array.isArray(config.args) ? config.args : [])]
								.filter((part) => typeof part === 'string')
								.join(' ') || null,
		}));
	}
	if (item.kind === 'plugin') {
		try {
			const manifest = JSON.parse(content.toString('utf8')) as { description?: unknown };
			const description =
				typeof manifest.description === 'string' ? manifest.description : null;
			return [{ ...base, description }];
		} catch {
			return [base];
		}
	}
	const front = readFrontmatter(content.toString('utf8'));
	return [{ ...base, description: front.description, declaredName: front.name }];
}

function describeRepo(
	deps: Deps,
	snapshot: RepoSnapshot,
	auth: GithubAuth | undefined,
): Promise<Described[]> {
	const known = described.get(snapshot);
	if (known) return known;
	const items = snapshot.items.filter((item) => item.kind !== 'marketplace');
	const pending = mapLimited(items, DESCRIBE_CONCURRENCY, (item) =>
		describeItem(deps, snapshot, item, auth, items.indexOf(item) < MAX_DESCRIBED),
	).then((lists) => lists.flat());
	described.set(snapshot, pending);
	pending.catch(() => described.delete(snapshot));
	return pending;
}

function matches(item: MarketplaceItem, query: string): boolean {
	if (!query) return true;
	const needle = query.toLowerCase();
	return (
		item.name.toLowerCase().includes(needle) ||
		(item.description?.toLowerCase().includes(needle) ?? false)
	);
}

const publicItem = ({ declaredName: _, ...item }: Described): MarketplaceItem => item;

export const ITEMS_PAGE = 30;

export type ItemSort = 'popular' | 'trending';

export interface ItemPage {
	items: MarketplaceItem[];
	/** Pass back as `cursor` for the next page; null on the last one. */
	next_cursor: string | null;
	/** Everything that matches, when the source says. */
	total: number | null;
}

/** Offset cursors: plain non-negative integers. */
function offsetOf(cursor: string | undefined): number {
	if (cursor === undefined) return 0;
	if (!/^\d{1,6}$/.test(cursor)) throw new AppError('validation_failed', { field: 'cursor' });
	return Number(cursor);
}

function slicePage<T>(
	items: T[],
	offset: number,
): { items: T[]; next_cursor: string | null; total: number } {
	const end = offset + ITEMS_PAGE;
	return {
		items: items.slice(offset, end),
		next_cursor: end < items.length ? String(end) : null,
		total: items.length,
	};
}

/** How long a skills.sh page waits for descriptions; late ones still fill the cache. */
const SKILLS_SH_DESCRIBE_MS = 2_000;

/** skills.sh hits as items, with descriptions read from their skill pages. */
async function skillsShItems(deps: Deps, hits: SkillsShHit[]): Promise<MarketplaceItem[]> {
	const descriptions = hits.map(() => null as string | null);
	const loading = mapLimited(hits, DESCRIBE_CONCURRENCY, async (hit) => {
		descriptions[hits.indexOf(hit)] = await deps.skillsSh.description(hit);
	});
	let timer: NodeJS.Timeout | undefined;
	await Promise.race([
		loading,
		new Promise((resolve) => (timer = setTimeout(resolve, SKILLS_SH_DESCRIBE_MS))),
	]);
	clearTimeout(timer);
	return hits.map((hit, index) => ({
		key: `${hit.source}@${hit.skillId}`,
		kind: 'skill',
		name: hit.skillId,
		description: descriptions[index] ?? null,
		repo: hit.source,
		installs: hit.installs,
	}));
}

/**
 * skills.sh without a search: its most installed or trending skills. Their
 * pages hold 200; we hand them out 30 at a time.
 */
async function skillsShBoard(deps: Deps, sort: ItemSort, offset: number): Promise<ItemPage> {
	const board = sort === 'trending' ? 'trending' : 'all-time';
	const upstream = Math.floor(offset / LEADERBOARD_PAGE);
	const page = await deps.skillsSh.leaderboard(board, upstream);
	const start = offset - upstream * LEADERBOARD_PAGE;
	const hits = page.hits.slice(start, start + ITEMS_PAGE);
	const end = offset + hits.length;
	const more = start + hits.length < page.hits.length || page.hasMore;
	return {
		items: await skillsShItems(deps, hits),
		next_cursor: more && hits.length > 0 ? String(end) : null,
		total: page.total,
	};
}

const mcpServerItem = (server: RegistryServer): MarketplaceItem => ({
	key: server.name,
	kind: 'mcp_server',
	name: shortServerName(server.name),
	description: server.description ?? null,
	repo: repoFromUrl(server.repository?.url),
	installs: null,
});

/** Cursors of pages that came from the registry's own search. */
const REGISTRY_CURSOR = 'r.';

/**
 * MCP Registry results from our copy of it (offset cursors); from the
 * registry's slow search until the copy is built, or when continuing a list
 * that started there.
 */
async function mcpRegistryPage(
	deps: Deps,
	query: string,
	cursor: string | undefined,
): Promise<ItemPage> {
	if (!cursor?.startsWith(REGISTRY_CURSOR) && (await deps.mcpIndex.ready())) {
		const offset = offsetOf(cursor);
		const { servers, total } = await deps.mcpIndex.search(query, offset, ITEMS_PAGE);
		const end = offset + servers.length;
		return {
			items: servers.map(mcpServerItem),
			next_cursor: servers.length > 0 && end < total ? String(end) : null,
			total,
		};
	}
	const page = await deps.mcpRegistry.search(query, cursor?.slice(REGISTRY_CURSOR.length));
	return {
		items: page.servers.filter((server) => toServerConfig(server) !== null).map(mcpServerItem),
		next_cursor: page.nextCursor ? REGISTRY_CURSOR + page.nextCursor : null,
		total: null,
	};
}

export async function listItems(
	deps: Deps,
	principal: Principal,
	id: string,
	options: {
		q?: string | undefined;
		kind?: ItemKind | undefined;
		cursor?: string | undefined;
		sort?: ItemSort | undefined;
	},
): Promise<ItemPage> {
	const { view, auth } = await resolveMarketplace(deps, principal, id);
	const query = options.q?.trim() ?? '';
	if (options.kind && !view.kinds.includes(options.kind)) {
		return { items: [], next_cursor: null, total: 0 };
	}

	if (view.source === 'skills_sh') {
		const offset = offsetOf(options.cursor);
		if (query.length < MIN_QUERY) return skillsShBoard(deps, options.sort ?? 'popular', offset);
		const hits = await deps.skillsSh.search(query);
		const page = slicePage(hits, offset);
		return { ...page, items: await skillsShItems(deps, page.items) };
	}
	if (view.source === 'mcp_registry') return mcpRegistryPage(deps, query, options.cursor);
	const offset = offsetOf(options.cursor);
	const snapshot = await deps.github.snapshot(view.repo!, undefined, auth);
	const items = await describeRepo(deps, snapshot, auth);
	return slicePage(
		items
			.filter((item) => view.kinds.includes(item.kind))
			.filter((item) => !options.kind || item.kind === options.kind)
			.filter((item) => matches(item, query))
			.map(publicItem),
		offset,
	);
}

function repoFromUrl(url: string | undefined): string | null {
	const match = url && /^https:\/\/github\.com\/([^/]+\/[^/#?]+)/.exec(url);
	const repo = match ? match[1]!.replace(/\.git$/, '') : null;
	return repo && REPO_PATTERN.test(repo) ? repo : null;
}

function jsonFile(value: unknown): ScannedFile {
	const content = Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
	return { path: 'server.json', size: content.length, content_b64: content.toString('base64') };
}

async function readRepoItem(
	deps: Deps,
	snapshot: RepoSnapshot,
	key: string,
	auth: GithubAuth | undefined,
): Promise<MarketplaceItemContent> {
	const [path, serverName] = key.split('#') as [string, string | undefined];
	const item = snapshot.items.find((entry) => entry.path === path);
	if (!item || item.kind === 'marketplace') throw new AppError('not_found');
	const url = `https://github.com/${snapshot.repo}/tree/${snapshot.sha}/${item.path === '.' ? '' : item.path}`;

	if (item.kind === 'mcp_server') {
		const content = await deps.github.file(snapshot.repo, snapshot.sha, item.path, auth);
		const config = serverName === undefined ? undefined : mcpServersOf(content)[serverName];
		if (!config || !serverName) throw new AppError('not_found');
		const description = typeof config.description === 'string' ? config.description : '';
		return {
			kind: 'mcp_server',
			name: serverName,
			description: description || null,
			files: [jsonFile({ name: serverName, description, ...config })],
			truncated: false,
			url,
		};
	}
	const { files, truncated } = await deps.github.readItem(snapshot, item, auth);
	const main = mainFile(item);
	const mainContent = main
		? files.find((file) => file.path === main.split('/').at(-1))
		: undefined;
	const description =
		item.kind === 'plugin' || !mainContent
			? null
			: readFrontmatter(Buffer.from(mainContent.content_b64, 'base64').toString('utf8'))
					.description;
	return { kind: item.kind as ItemKind, name: item.name, description, files, truncated, url };
}

export async function readItem(
	deps: Deps,
	principal: Principal,
	id: string,
	key: string,
): Promise<MarketplaceItemContent> {
	const { view, auth } = await resolveMarketplace(deps, principal, id);

	if (view.source === 'mcp_registry') {
		const server = (await deps.mcpIndex.get(key)) ?? (await deps.mcpRegistry.server(key));
		const config = toServerConfig(server);
		if (!config) {
			throw new AppError('validation_failed', {
				reason: 'this server cannot be run locally',
			});
		}
		return {
			kind: 'mcp_server',
			name: config.name,
			description: config.description || null,
			files: [jsonFile(config)],
			truncated: false,
			url:
				server.websiteUrl ??
				server.repository?.url ??
				'https://registry.modelcontextprotocol.io',
		};
	}
	if (view.source === 'skills_sh') {
		const at = key.lastIndexOf('@');
		const repo = key.slice(0, at);
		const skillId = key.slice(at + 1);
		if (at < 0 || !REPO_PATTERN.test(repo) || !skillId) throw new AppError('not_found');
		const snapshot = await deps.github.snapshot(repo);
		const skills = snapshot.items.filter((item) => item.kind === 'skill');
		let item = skills.find((entry) => entry.name === skillId);
		if (!item) {
			const declared = (await describeRepo(deps, snapshot, undefined)).find(
				(entry) => entry.kind === 'skill' && entry.declaredName === skillId,
			);
			item = skills.find((entry) => entry.path === declared?.key);
		}
		if (!item) throw new AppError('not_found', { reason: 'skill not found in its repository' });
		return readRepoItem(deps, snapshot, item.path, undefined);
	}
	const snapshot = await deps.github.snapshot(view.repo!, undefined, auth);
	return readRepoItem(deps, snapshot, key, auth);
}

export async function listGithubRepositories(deps: Deps, principal: Principal) {
	const app = deps.githubApp;
	if (!app) return { repositories: [] };
	const installations = await withTenantTx(deps.db.app, principal.storageAccountId, (tx) =>
		tx.select().from(githubInstallations),
	);
	const lists = await Promise.allSettled(
		installations.map(async (installation) =>
			(await app.repositories(installation.installationId)).map((repo) => ({
				...repo,
				installation_id: installation.installationId,
			})),
		),
	);
	// One uninstalled or failing installation must not hide the others.
	const repositories = lists.flatMap((list, index) => {
		if (list.status === 'fulfilled') return list.value;
		deps.log.warn(
			{ err: list.reason, installationId: installations[index]?.installationId },
			'github installation repositories failed',
		);
		return [];
	});
	return { repositories };
}

export async function connectGithub(deps: Deps, principal: Principal, code: string) {
	const app = deps.githubApp;
	if (!app) throw new AppError('forbidden', { reason: 'GitHub App is not configured' });
	const verified = await app.verifiedInstallations(code);
	await withTenantTx(deps.db.app, principal.storageAccountId, async (tx) => {
		await tx.delete(githubInstallations);
		if (verified.length === 0) return;
		await tx.insert(githubInstallations).values(
			verified.map((installation) => ({
				storageAccountId: principal.storageAccountId,
				installationId: installation.installationId,
				accountLogin: installation.accountLogin,
				accountType: installation.accountType,
				githubUserId: installation.githubUserId,
			})),
		);
	});
	return {
		connections: verified.map((installation) => ({
			installation_id: installation.installationId,
			account: installation.accountLogin,
			type: installation.accountType,
		})),
	};
}

/** Forgets the GitHub connection and every private marketplace that needed it. */
export async function disconnectGithub(deps: Deps, principal: Principal) {
	const removed = await withTenantTx(deps.db.app, principal.storageAccountId, async (tx) => {
		await tx.delete(marketplaces).where(isNotNull(marketplaces.installationId));
		return tx
			.delete(githubInstallations)
			.returning({ installationId: githubInstallations.installationId });
	});
	for (const { installationId } of removed) deps.githubApp?.forget(installationId);
}
