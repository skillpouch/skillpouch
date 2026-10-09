// SPDX-License-Identifier: AGPL-3.0-only
/** Marketplaces and the GitHub connection for private repositories. */
import { z } from 'zod';
import type { Deps } from '../../deps';
import { principalOf } from '../../http/principal';
import type { ZodApp } from '../../http/zod-app';
import {
	addMarketplace,
	connectGithub,
	disconnectGithub,
	inspectRepository,
	listGithubRepositories,
	listItems,
	listMarketplaces,
	readItem,
	readRepositoryItem,
	removeMarketplace,
} from './marketplaces.service';

const ItemKind = z.enum(['skill', 'agent', 'command', 'instructions', 'mcp_server', 'plugin']);

const Marketplace = z.object({
	id: z.string(),
	source: z.enum(['skills_sh', 'mcp_registry', 'github']),
	name: z.string(),
	description: z.string().nullable(),
	repo: z.string().nullable(),
	private: z.boolean(),
	builtin: z.boolean(),
	url: z.string(),
	kinds: z.array(ItemKind),
});

const GithubConnection = z.object({
	installation_id: z.number().int(),
	account: z.string(),
	type: z.enum(['User', 'Organization']),
});

const MarketplaceList = z.object({
	marketplaces: z.array(Marketplace),
	github: z.object({
		available: z.boolean(),
		install_url: z.string().nullable(),
		authorize_url: z.string().nullable(),
		connections: z.array(GithubConnection),
	}),
});

const IdParam = z.object({ marketplaceId: z.string().max(64) });

const ItemsQuery = z.object({
	q: z.string().max(200).optional(),
	kind: ItemKind.optional(),
	cursor: z.string().max(500).optional(),
	sort: z.enum(['popular', 'trending']).optional(),
});

const Item = z.object({
	key: z.string(),
	kind: ItemKind,
	name: z.string(),
	description: z.string().nullable(),
	repo: z.string().nullable(),
	installs: z.number().int().nullable(),
});

const ItemContent = z.object({
	kind: ItemKind,
	name: z.string(),
	description: z.string().nullable(),
	files: z.array(z.object({ path: z.string(), size: z.number().int(), content_b64: z.string() })),
	truncated: z.boolean(),
	url: z.string(),
});

const RepoQuery = z.object({ repo: z.string().min(3).max(300) });

const Repository = z.object({
	repo: z.string(),
	private: z.boolean(),
	url: z.string(),
	marketplace_id: z.string().nullable(),
	has_manifest: z.boolean(),
	items: z.array(Item),
});

export async function marketplacesRoutes(app: ZodApp, deps: Deps) {
	app.get(
		'/v1/marketplaces',
		{
			config: { auth: 'any' },
			schema: {
				tags: ['marketplaces'],
				summary: 'Built-in and added marketplaces, and the GitHub connection',
				response: { 200: MarketplaceList },
			},
		},
		async (request) => listMarketplaces(deps, principalOf(request)),
	);

	app.post(
		'/v1/marketplaces',
		{
			config: { auth: 'any', rateLimit: 'import' },
			schema: {
				tags: ['marketplaces'],
				summary:
					'Add a GitHub repository as a marketplace (public, or private via the GitHub App)',
				body: z.object({ repo: z.string().min(3).max(300) }),
				response: { 200: Marketplace },
			},
		},
		async (request) => addMarketplace(deps, principalOf(request), request.body.repo),
	);

	app.delete(
		'/v1/marketplaces/:marketplaceId',
		{
			config: { auth: 'any' },
			schema: {
				tags: ['marketplaces'],
				summary: 'Remove an added marketplace',
				params: IdParam,
				response: { 200: z.object({ removed: z.literal(true) }) },
			},
		},
		async (request) => {
			await removeMarketplace(deps, principalOf(request), request.params.marketplaceId);
			return { removed: true as const };
		},
	);

	app.get(
		'/v1/marketplaces/:marketplaceId/items',
		{
			config: { auth: 'any', rateLimit: 'marketplace' },
			schema: {
				tags: ['marketplaces'],
				summary: 'Search or list what a marketplace offers',
				description:
					'Pages of 30 or so; pass `next_cursor` back as `cursor` for more. Without `q`, skills.sh lists its most installed (`sort=popular`) or trending skills.',
				params: IdParam,
				querystring: ItemsQuery,
				response: {
					200: z.object({
						items: z.array(Item),
						next_cursor: z.string().nullable(),
						total: z.number().int().nullable(),
					}),
				},
			},
		},
		async (request) =>
			listItems(deps, principalOf(request), request.params.marketplaceId, request.query),
	);

	app.get(
		'/v1/marketplaces/:marketplaceId/item',
		{
			config: { auth: 'any', rateLimit: 'marketplace' },
			schema: {
				tags: ['marketplaces'],
				summary: "One item's files, ready to encrypt and save",
				params: IdParam,
				querystring: z.object({ key: z.string().min(1).max(500) }),
				response: { 200: ItemContent },
			},
		},
		async (request) =>
			readItem(deps, principalOf(request), request.params.marketplaceId, request.query.key),
	);

	app.get(
		'/v1/github/repository',
		{
			config: { auth: 'any', rateLimit: 'marketplace' },
			schema: {
				tags: ['marketplaces'],
				summary: 'What one GitHub repository holds, without adding it as a marketplace',
				description:
					'Public repositories, or private ones the connected GitHub App installations can read.',
				querystring: RepoQuery,
				response: { 200: Repository },
			},
		},
		async (request) => inspectRepository(deps, principalOf(request), request.query.repo),
	);

	app.get(
		'/v1/github/repository/item',
		{
			config: { auth: 'any', rateLimit: 'marketplace' },
			schema: {
				tags: ['marketplaces'],
				summary: "One item's files from a GitHub repository, ready to encrypt and save",
				querystring: RepoQuery.extend({ key: z.string().min(1).max(500) }),
				response: { 200: ItemContent },
			},
		},
		async (request) =>
			readRepositoryItem(deps, principalOf(request), request.query.repo, request.query.key),
	);

	app.get(
		'/v1/github/repositories',
		{
			config: { auth: 'any', rateLimit: 'marketplace' },
			schema: {
				tags: ['marketplaces'],
				summary: 'Repositories the connected GitHub App installations can read',
				response: {
					200: z.object({
						repositories: z.array(
							z.object({
								full_name: z.string(),
								private: z.boolean(),
								description: z.string().nullable(),
								installation_id: z.number().int(),
							}),
						),
					}),
				},
			},
		},
		async (request) => listGithubRepositories(deps, principalOf(request)),
	);

	app.post(
		'/v1/github/connect',
		{
			config: { auth: 'session', rateLimit: 'import' },
			schema: {
				tags: ['marketplaces'],
				summary: 'Connect GitHub with the code from its redirect',
				description:
					'Keeps only installations GitHub lists for the authorizing user: their own account or organizations they administer.',
				body: z.object({ code: z.string().min(1).max(200) }),
				response: { 200: z.object({ connections: z.array(GithubConnection) }) },
			},
		},
		async (request) => connectGithub(deps, principalOf(request), request.body.code),
	);

	app.delete(
		'/v1/github/connect',
		{
			config: { auth: 'session' },
			schema: {
				tags: ['marketplaces'],
				summary: 'Disconnect GitHub and remove private-repository marketplaces',
				response: { 200: z.object({ disconnected: z.literal(true) }) },
			},
		},
		async (request) => {
			await disconnectGithub(deps, principalOf(request));
			return { disconnected: true as const };
		},
	);
}
