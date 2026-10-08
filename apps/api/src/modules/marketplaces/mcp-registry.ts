// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The official MCP Registry (registry.modelcontextprotocol.io): open API, no
 * key. Entries are turned into SkillPouch `server.json` configs — a package
 * run locally (npx / uvx / docker) when there is one, else the remote URL.
 * Environment variables and headers come out empty: they usually hold
 * secrets the user fills in.
 */
import { z } from 'zod';
import { AppError } from '../../http/app-error';

const REGISTRY = 'https://registry.modelcontextprotocol.io/v0';
const CACHE_TTL_MS = 5 * 60_000;
const MAX_CACHED = 200;
/** The registry answers a search in 10–30 s, so search runs on `McpRegistryIndex` once it's built. */
const TIMEOUT_MS = 30_000;
/** Listing pages for the index: usually under a second, sometimes 20. */
const PAGE_TIMEOUT_MS = 60_000;
export const REGISTRY_PAGE = 100;

const Argument = z.object({ type: z.string().optional(), value: z.string().optional() });
const Variable = z.object({ name: z.string(), default: z.string().optional() });

const Server = z.object({
	name: z.string(),
	description: z.string().optional(),
	version: z.string().optional(),
	repository: z.object({ url: z.string().optional() }).optional(),
	websiteUrl: z.string().optional(),
	packages: z
		.array(
			z.object({
				registryType: z.string(),
				identifier: z.string(),
				runtimeHint: z.string().optional(),
				transport: z.object({ type: z.string() }).optional(),
				packageArguments: z.array(Argument).optional(),
				environmentVariables: z.array(Variable).optional(),
			}),
		)
		.optional(),
	remotes: z
		.array(
			z.object({
				type: z.string(),
				url: z.string(),
				headers: z.array(Variable).optional(),
			}),
		)
		.optional(),
});
export type RegistryServer = z.infer<typeof Server>;

const Official = z.object({ status: z.string().optional() });

const ListResponse = z.object({
	servers: z.array(
		z.object({
			server: Server,
			_meta: z
				.object({ 'io.modelcontextprotocol.registry/official': Official.optional() })
				.optional(),
		}),
	),
	metadata: z.object({ nextCursor: z.string().optional() }).optional(),
});

export interface RegistryEntry {
	server: RegistryServer;
	/** `active`, `deprecated` or `deleted`. */
	status: string;
}
const OneResponse = z.object({ server: Server });

export type ServerConfig =
	| {
			name: string;
			description: string;
			command: string;
			args: string[];
			env: Record<string, string>;
	  }
	| {
			name: string;
			description: string;
			type: 'http' | 'sse';
			url: string;
			headers: Record<string, string>;
	  };

/** `io.github.acme/weather-mcp` → `weather-mcp`. */
export function shortServerName(name: string): string {
	const last = name.split('/').at(-1) ?? name;
	return (
		last
			.toLowerCase()
			.replace(/[^a-z0-9._-]+/g, '-')
			.slice(0, 64) || 'mcp-server'
	);
}

const RUNNERS: Record<string, (identifier: string) => { command: string; args: string[] }> = {
	npm: (identifier) => ({ command: 'npx', args: ['-y', identifier] }),
	pypi: (identifier) => ({ command: 'uvx', args: [identifier] }),
	oci: (identifier) => ({ command: 'docker', args: ['run', '-i', '--rm', identifier] }),
};

const emptyValues = (variables: { name: string; default?: string | undefined }[] | undefined) =>
	Object.fromEntries(
		(variables ?? []).map((variable) => [variable.name, variable.default ?? '']),
	);

/** The registry entry as a SkillPouch `server.json`; null when nothing can run it. */
export function toServerConfig(server: RegistryServer): ServerConfig | null {
	const name = shortServerName(server.name);
	const description = server.description ?? '';
	for (const pkg of server.packages ?? []) {
		const runner = RUNNERS[pkg.registryType];
		if (!runner || (pkg.transport && pkg.transport.type !== 'stdio')) continue;
		const { command, args } = runner(pkg.identifier);
		const extra = (pkg.packageArguments ?? [])
			.filter((arg) => arg.type === 'positional' && arg.value)
			.map((arg) => arg.value as string);
		return {
			name,
			description,
			command,
			args: [...args, ...extra],
			env: emptyValues(pkg.environmentVariables),
		};
	}
	const remote = server.remotes?.find(
		(entry) => entry.type === 'streamable-http' || entry.type === 'sse',
	);
	if (remote) {
		return {
			name,
			description,
			type: remote.type === 'sse' ? 'sse' : 'http',
			url: remote.url,
			headers: emptyValues(remote.headers),
		};
	}
	return null;
}

export class McpRegistryClient {
	private readonly cache = new Map<string, { expires: number; value: unknown }>();

	constructor(private readonly http: typeof fetch = fetch) {}

	private async get<T>(
		url: string,
		schema: z.ZodType<T>,
		{ cache = true, timeoutMs = TIMEOUT_MS } = {},
	): Promise<T> {
		const cached = cache ? this.cache.get(url) : undefined;
		if (cached && cached.expires > Date.now()) return cached.value as T;
		const response = await this.http(url, {
			headers: { Accept: 'application/json', 'User-Agent': 'skillpouch' },
			signal: AbortSignal.timeout(timeoutMs),
		}).catch((cause: unknown) => {
			throw new AppError('upstream_unavailable', { service: 'mcp-registry' }, { cause });
		});
		if (response.status === 404)
			throw new AppError('not_found', { reason: 'no such MCP server' });
		if (!response.ok) {
			throw new AppError('upstream_unavailable', {
				service: 'mcp-registry',
				status: response.status,
			});
		}
		const parsed = schema.safeParse(await response.json().catch(() => null));
		if (!parsed.success) {
			throw new AppError('upstream_unavailable', {
				service: 'mcp-registry',
				reason: 'unexpected response',
			});
		}
		if (!cache) return parsed.data;
		this.cache.delete(url);
		this.cache.set(url, { expires: Date.now() + CACHE_TTL_MS, value: parsed.data });
		for (const oldKey of this.cache.keys()) {
			if (this.cache.size <= MAX_CACHED) break;
			this.cache.delete(oldKey);
		}
		return parsed.data;
	}

	/** One page of servers matching `query` (all of them when empty). */
	async search(
		query: string,
		cursor?: string,
		limit = 30,
	): Promise<{ servers: RegistryServer[]; nextCursor: string | null }> {
		const params = new URLSearchParams({ limit: String(limit), version: 'latest' });
		if (query.trim()) params.set('search', query.trim());
		if (cursor) params.set('cursor', cursor);
		const body = await this.get(`${REGISTRY}/servers?${params}`, ListResponse);
		return {
			servers: body.servers.map((entry) => entry.server),
			nextCursor: body.metadata?.nextCursor || null,
		};
	}

	/**
	 * One uncached page of the latest version of every server, or of those
	 * changed since `updatedSince` (then including deleted ones).
	 */
	async listPage(
		cursor?: string,
		updatedSince?: string,
	): Promise<{ entries: RegistryEntry[]; nextCursor: string | null }> {
		const params = new URLSearchParams({ limit: String(REGISTRY_PAGE), version: 'latest' });
		if (cursor) params.set('cursor', cursor);
		if (updatedSince) params.set('updated_since', updatedSince);
		const body = await this.get(`${REGISTRY}/servers?${params}`, ListResponse, {
			cache: false,
			timeoutMs: PAGE_TIMEOUT_MS,
		});
		return {
			entries: body.servers.map((entry) => ({
				server: entry.server,
				status:
					entry._meta?.['io.modelcontextprotocol.registry/official']?.status ?? 'active',
			})),
			nextCursor: body.metadata?.nextCursor || null,
		};
	}

	async server(name: string): Promise<RegistryServer> {
		const body = await this.get(
			`${REGISTRY}/servers/${encodeURIComponent(name)}/versions/latest`,
			OneResponse,
		);
		return body.server;
	}
}
