// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Marketplaces: skills.sh, the MCP Registry, well-known repositories and the
 * account's own GitHub repositories (private ones through the GitHub App).
 * The API lists items and returns one item's files; adding it encrypts and
 * commits those files into a pouch like any other edit.
 */
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';
import { api } from '@/lib/api/client';
import { queryKeys } from '@/lib/api/query-keys';
import { addToPouch, type DuplicateChoice } from '../ingredients/add-to-pouch';
import { inScope, usePouchContents, type Ingredient } from '../ingredients/ingredients';
import { kindDefinition, NAME_MAX, NAME_PATTERN, type IngredientKind } from '../ingredients/kinds';
import type { DraftFile } from '../ingredients/write';
import type { PouchView } from '../pouches/pouches';

export type MarketplaceSource = 'skills_sh' | 'mcp_registry' | 'github';
export type MarketplaceKind = Exclude<IngredientKind, 'hook'>;

export interface Marketplace {
	id: string;
	source: MarketplaceSource;
	name: string;
	description: string | null;
	repo: string | null;
	private: boolean;
	builtin: boolean;
	url: string;
	kinds: MarketplaceKind[];
}

export interface GithubConnection {
	installation_id: number;
	account: string;
	type: 'User' | 'Organization';
}

export interface MarketplaceList {
	marketplaces: Marketplace[];
	github: {
		available: boolean;
		install_url: string | null;
		authorize_url: string | null;
		connections: GithubConnection[];
	};
}

export interface MarketplaceItem {
	key: string;
	kind: MarketplaceKind;
	name: string;
	description: string | null;
	repo: string | null;
	installs: number | null;
}

export interface MarketplaceItemContent {
	kind: MarketplaceKind;
	name: string;
	description: string | null;
	files: { path: string; size: number; content_b64: string }[];
	truncated: boolean;
	url: string;
}

export interface GithubRepository {
	full_name: string;
	private: boolean;
	description: string | null;
	installation_id: number;
}

export type ItemSort = 'popular' | 'trending';

export interface ItemPage {
	items: MarketplaceItem[];
	next_cursor: string | null;
	total: number | null;
}

/** Directories search upstream, which is slower; repositories search locally. */
export function searchesRemotely(marketplace: Pick<Marketplace, 'source'>): boolean {
	return marketplace.source !== 'github';
}

/** skills.sh lists its most installed or trending skills until you search. */
export function hasLeaderboard(marketplace: Pick<Marketplace, 'source'>): boolean {
	return marketplace.source === 'skills_sh';
}

/** Marketplaces that offer `kind`, or all of them. */
export function offering(marketplaces: Marketplace[], kind?: IngredientKind): Marketplace[] {
	if (!kind) return marketplaces;
	return marketplaces.filter((entry) => (entry.kinds as IngredientKind[]).includes(kind));
}

export type MarketplaceGroupId = 'directories' | 'featured' | 'yours';

export interface MarketplaceGroup {
	id: MarketplaceGroupId;
	label: string;
	marketplaces: Marketplace[];
}

/**
 * The rail's sections: big directories, repositories we ship, then the
 * account's own. `filter` matches name or `owner/repo`; empty groups go.
 */
export function groupMarketplaces(marketplaces: Marketplace[], filter = ''): MarketplaceGroup[] {
	const needle = filter.trim().toLowerCase();
	const shown = needle
		? marketplaces.filter(
				(entry) =>
					entry.name.toLowerCase().includes(needle) ||
					(entry.repo?.toLowerCase().includes(needle) ?? false),
			)
		: marketplaces;
	const groups: MarketplaceGroup[] = [
		{
			id: 'directories',
			label: 'Directories',
			marketplaces: shown.filter((entry) => entry.source !== 'github'),
		},
		{
			id: 'featured',
			label: 'Featured',
			marketplaces: shown.filter((entry) => entry.source === 'github' && entry.builtin),
		},
		{
			id: 'yours',
			label: 'Your marketplaces',
			marketplaces: shown.filter((entry) => !entry.builtin),
		},
	];
	return groups.filter((group) => group.marketplaces.length > 0);
}

export function useMarketplaces() {
	return useQuery({
		queryKey: queryKeys.marketplaces,
		queryFn: () => api.get<MarketplaceList>('/v1/marketplaces'),
		staleTime: 60_000,
	});
}

/** Pages of items; `fetchNextPage` loads the next one. */
export function useMarketplaceItems(
	marketplace: Marketplace | undefined,
	query: string,
	kind: IngredientKind | undefined,
	sort: ItemSort,
) {
	const q = query.trim();
	const sentSort = marketplace && hasLeaderboard(marketplace) && q.length < 2 ? sort : undefined;
	return useInfiniteQuery({
		queryKey: queryKeys.marketplaceItems(marketplace?.id ?? '', q, kind ?? '', sentSort ?? ''),
		queryFn: ({ pageParam, signal }) =>
			api.get<ItemPage>(`/v1/marketplaces/${marketplace!.id}/items`, {
				query: { q: q || undefined, kind, sort: sentSort, cursor: pageParam },
				signal,
			}),
		initialPageParam: undefined as string | undefined,
		getNextPageParam: (page) => page.next_cursor ?? undefined,
		enabled: marketplace !== undefined,
		staleTime: 5 * 60_000,
	});
}

export function fetchMarketplaceItem(marketplaceId: string, key: string) {
	return api.get<MarketplaceItemContent>(`/v1/marketplaces/${marketplaceId}/item`, {
		query: { key },
	});
}

/** A GitHub repository read on its own, without adding it as a marketplace. */
export interface RepositoryView {
	repo: string;
	private: boolean;
	url: string;
	/** Set when it already is one of your (or a built-in) marketplaces. */
	marketplace_id: string | null;
	has_manifest: boolean;
	items: MarketplaceItem[];
}

export function useRepository(repo: string | null) {
	return useQuery({
		queryKey: queryKeys.githubRepository(repo ?? ''),
		queryFn: ({ signal }) =>
			api.get<RepositoryView>('/v1/github/repository', { query: { repo: repo! }, signal }),
		enabled: repo !== null,
		retry: false,
		staleTime: 5 * 60_000,
	});
}

export function fetchRepositoryItem(repo: string, key: string) {
	return api.get<MarketplaceItemContent>('/v1/github/repository/item', {
		query: { repo, key },
	});
}

export type RepositoryOffer =
	/** The repository is this one item: add it straight away. */
	| { type: 'item'; item: MarketplaceItem }
	/** Several of them (or a marketplace manifest): browse it as a marketplace. */
	| { type: 'marketplace'; count: number }
	/** None of this kind; `others` says what it holds instead. */
	| { type: 'none'; others: { kind: MarketplaceKind; count: number }[] };

/** What a repository offers when adding one `kind`. */
export function repositoryOffer(view: RepositoryView, kind: IngredientKind): RepositoryOffer {
	const matching = view.items.filter((item) => item.kind === kind);
	if (matching.length === 1 && !(view.has_manifest && view.items.length > 1)) {
		return { type: 'item', item: matching[0]! };
	}
	if (matching.length > 0) return { type: 'marketplace', count: matching.length };
	const counts = new Map<MarketplaceKind, number>();
	for (const item of view.items) counts.set(item.kind, (counts.get(item.kind) ?? 0) + 1);
	return {
		type: 'none',
		others: [...counts].map(([other, count]) => ({ kind: other, count })),
	};
}

/** Lower case for running text, keeping acronyms: `MCP servers` stays. */
export function noun(text: string): string {
	return text
		.split(' ')
		.map((word) => (word.length > 1 && word === word.toUpperCase() ? word : word.toLowerCase()))
		.join(' ');
}

/** `1 skill`, `12 skills`, `2 MCP servers`. */
export function kindCount(kind: IngredientKind, count: number): string {
	const definition = kindDefinition(kind);
	if (!definition) return String(count);
	return `${count} ${noun(count === 1 ? definition.singular : definition.label)}`;
}

export function useInvalidateMarketplaces() {
	const client = useQueryClient();
	return () => client.invalidateQueries({ queryKey: queryKeys.marketplaces });
}

export function useAddMarketplace() {
	const invalidate = useInvalidateMarketplaces();
	return useMutation({
		mutationFn: (repo: string) => api.post<Marketplace>('/v1/marketplaces', { repo }),
		onSuccess: invalidate,
	});
}

export function useRemoveMarketplace() {
	const invalidate = useInvalidateMarketplaces();
	return useMutation({
		mutationFn: (id: string) => api.delete(`/v1/marketplaces/${id}`),
		onSuccess: invalidate,
	});
}

export function useGithubRepositories(enabled: boolean) {
	return useQuery({
		queryKey: queryKeys.githubRepositories,
		queryFn: () => api.get<{ repositories: GithubRepository[] }>('/v1/github/repositories'),
		enabled,
		staleTime: 60_000,
	});
}

export function useDisconnectGithub() {
	const invalidate = useInvalidateMarketplaces();
	return useMutation({
		mutationFn: () => api.delete('/v1/github/connect'),
		onSuccess: invalidate,
	});
}

const STATE_KEY = 'skillpouch.github.state';
const RETURN_KEY = 'skillpouch.github.return';

/**
 * Sends the browser to GitHub. `install` opens the app's install page (pick
 * repositories); otherwise it only re-authorizes. Either way GitHub returns to
 * `/github/connected` with a code, checked against the state we stored here.
 */
export function startGithubConnect(
	github: MarketplaceList['github'],
	returnTo: string,
	mode: 'install' | 'authorize' = 'install',
): void {
	const base = mode === 'install' ? github.install_url : github.authorize_url;
	if (!base) throw new Error('GitHub isn’t set up on this server.');
	const state = crypto.randomUUID();
	sessionStorage.setItem(STATE_KEY, state);
	sessionStorage.setItem(RETURN_KEY, returnTo);
	const url = new URL(base);
	url.searchParams.set('state', state);
	location.assign(url.toString());
}

/** The return path when `state` is the one this tab sent to GitHub; null otherwise. */
export function takeGithubReturn(state: string | null): string | null {
	const expected = sessionStorage.getItem(STATE_KEY);
	const returnTo = sessionStorage.getItem(RETURN_KEY);
	sessionStorage.removeItem(STATE_KEY);
	sessionStorage.removeItem(RETURN_KEY);
	if (!state || !expected || state !== expected) return null;
	return returnTo ?? '/app';
}

export function connectGithub(code: string) {
	return api.post<{ connections: GithubConnection[] }>('/v1/github/connect', { code });
}

/**
 * `owner/name` from what someone typed or pasted: `owner/name`,
 * `github.com/owner/name`, a full URL (tree/blob paths and `.git` ignored).
 * Null until it looks like a repository.
 */
export function parseRepoInput(text: string): string | null {
	const cleaned = text
		.trim()
		.replace(/^(?:https?:\/\/)?(?:www\.)?github\.com\//i, '')
		.replace(/^git@github\.com:/i, '');
	const match = /^([A-Za-z0-9-]{1,39})\/([A-Za-z0-9._-]{1,100}?)(?:\.git)?(?:[/?#].*)?$/.exec(
		cleaned,
	);
	return match ? `${match[1]}/${match[2]}` : null;
}

export function base64Bytes(value: string): Uint8Array {
	return Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
}

/**
 * Where an item's files go in a pouch. Instruction files (AGENTS.md,
 * CLAUDE.md, …) become the pouch's one instructions file.
 */
export function itemFiles(item: MarketplaceItemContent): DraftFile[] {
	const files = item.files.map((file) => ({
		path: file.path,
		bytes: base64Bytes(file.content_b64),
	}));
	const definition = kindDefinition(item.kind);
	if (definition?.single && files.length === 1) {
		return [{ ...files[0]!, path: definition.mainFile }];
	}
	return files;
}

/** A marketplace name as a valid pouch name: `My Skill!` → `My-Skill`. */
export function safeItemName(name: string, fallback: string): string {
	const cleaned = name
		.replace(/[^A-Za-z0-9._-]+/g, '-')
		.replace(/^[^A-Za-z0-9]+/, '')
		.slice(0, NAME_MAX)
		.replace(/-+$/, '');
	return NAME_PATTERN.test(cleaned) ? cleaned : fallback;
}

/** The name an item gets in a pouch. */
export function pouchName(item: { kind: MarketplaceKind; name: string }): string {
	return safeItemName(item.name, item.kind.replace('_', '-'));
}

/**
 * Finds what the pouch already has from a marketplace, by kind and name, from
 * the contents the pouch has already decrypted: no extra requests. Kinds kept
 * as one file per pouch (instructions) are never "installed": adding appends.
 */
export function installedLookup(
	ingredients: Ingredient[],
): (item: { kind: MarketplaceKind; name: string }) => Ingredient | undefined {
	const byKey = new Map(
		inScope(ingredients).map((ingredient) => [
			`${ingredient.kind}:${ingredient.name.toLowerCase()}`,
			ingredient,
		]),
	);
	return (item) =>
		kindDefinition(item.kind)?.single
			? undefined
			: byKey.get(`${item.kind}:${pouchName(item).toLowerCase()}`);
}

export function useInstalled(pouchId: string) {
	const contents = usePouchContents(pouchId);
	const ingredients = contents.data?.ingredients;
	return useMemo(() => installedLookup(ingredients ?? []), [ingredients]);
}

export async function addItemToPouch(input: {
	pouch: PouchView;
	item: MarketplaceItemContent;
	duplicate: DuplicateChoice;
}): Promise<{ name: string }> {
	return addToPouch({
		pouch: input.pouch,
		kind: input.item.kind,
		name: pouchName(input.item),
		files: itemFiles(input.item),
		duplicate: input.duplicate,
	});
}
