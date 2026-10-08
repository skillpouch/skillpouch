// SPDX-License-Identifier: AGPL-3.0-only
/**
 * skills.sh search and leaderboards. Its documented API needs a Vercel OIDC
 * token, so this uses the endpoints the site itself calls; every hit names a
 * public GitHub repo and a skill folder, which we then read from GitHub. Hits
 * carry no description, so those come from each skill page's meta tag. If
 * skills.sh changes or goes away, these fail with `upstream_unavailable` and
 * nothing else breaks.
 */
import { z } from 'zod';
import { AppError } from '../../http/app-error';
import { REPO_PATTERN } from '../import/github.service';

const SITE_URL = 'https://www.skills.sh';
const BASE_URL = `${SITE_URL}/api`;
const CACHE_TTL_MS = 5 * 60_000;
const MAX_CACHED = 200;
const DESCRIPTION_TTL_MS = 24 * 60 * 60_000;
const MAX_DESCRIPTIONS = 5_000;
/** The site's search returns at most about this many hits, without paging. */
const SEARCH_LIMIT = 100;

export const MIN_QUERY = 2;
/** skills.sh leaderboards come in pages of this size. */
export const LEADERBOARD_PAGE = 200;

export type SkillsShBoard = 'all-time' | 'trending';

export interface SkillsShHit {
	/** `owner/repo` on GitHub. */
	source: string;
	skillId: string;
	name: string;
	installs: number;
}

export interface SkillsShBoardPage {
	hits: SkillsShHit[];
	total: number;
	hasMore: boolean;
}

const Hit = z.object({
	source: z.string(),
	skillId: z.string(),
	name: z.string(),
	installs: z.number().optional(),
});

const SearchResponse = z.object({ skills: z.array(Hit) });

const BoardResponse = z.object({
	skills: z.array(Hit),
	total: z.number().int().optional(),
	hasMore: z.boolean().optional(),
});

const ENTITIES: Record<string, string> = {
	amp: '&',
	quot: '"',
	apos: "'",
	lt: '<',
	gt: '>',
	nbsp: ' ',
};

function decodeEntities(text: string): string {
	return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (entity, code: string) => {
		if (code[0] === '#') {
			const point =
				code[1] === 'x' || code[1] === 'X'
					? parseInt(code.slice(2), 16)
					: Number(code.slice(1));
			return Number.isFinite(point) && point <= 0x10ffff
				? String.fromCodePoint(point)
				: entity;
		}
		return ENTITIES[code.toLowerCase()] ?? entity;
	});
}

/**
 * The description in a skill page's `<meta name="description">`, or null when
 * the page only has the site's stand-in text for skills without one.
 */
export function descriptionFromPage(html: string): string | null {
	const tag = /<meta\s+name="description"\s+content="([^"]*)"/i.exec(html);
	if (!tag) return null;
	const text = decodeEntities(tag[1]!).replace(/\s+/g, ' ').trim();
	if (text === '' || / — an installable skill for AI agents, published by /.test(text)) {
		return null;
	}
	return text;
}

function cleanHits(hits: z.infer<typeof Hit>[]): SkillsShHit[] {
	return hits
		.filter((hit) => REPO_PATTERN.test(hit.source) && hit.skillId.length > 0)
		.map((hit) => ({
			source: hit.source,
			skillId: hit.skillId,
			name: hit.name,
			installs: hit.installs ?? 0,
		}));
}

export class SkillsShClient {
	private readonly cache = new Map<string, { expires: number; value: unknown }>();
	private readonly descriptions = new Map<string, { expires: number; value: string | null }>();

	constructor(private readonly http: typeof fetch = fetch) {}

	/** Up to 100 hits for `query`, best first. */
	async search(query: string): Promise<SkillsShHit[]> {
		const q = query.trim();
		if (q.length < MIN_QUERY) return [];
		const url = `${BASE_URL}/search?q=${encodeURIComponent(q)}&limit=${SEARCH_LIMIT}`;
		const body = await this.get(url, SearchResponse);
		return cleanHits(body.skills);
	}

	/** One page of the most installed (`all-time`) or `trending` skills. */
	async leaderboard(board: SkillsShBoard, page: number): Promise<SkillsShBoardPage> {
		const body = await this.get(`${BASE_URL}/skills/${board}/${page}`, BoardResponse);
		const total = body.total ?? (page + 1) * LEADERBOARD_PAGE;
		return {
			hits: cleanHits(body.skills),
			total,
			hasMore: body.hasMore ?? (page + 1) * LEADERBOARD_PAGE < total,
		};
	}

	/** The skill's one-line description; null when it has none or the page fails. */
	async description(hit: Pick<SkillsShHit, 'source' | 'skillId'>): Promise<string | null> {
		const url = `${SITE_URL}/${hit.source}/${encodeURIComponent(hit.skillId)}`;
		const cached = this.descriptions.get(url);
		if (cached && cached.expires > Date.now()) return cached.value;

		const value = await this.http(url, {
			headers: { Accept: 'text/html', 'User-Agent': 'skillpouch' },
			signal: AbortSignal.timeout(5_000),
		})
			.then(async (response) =>
				response.ok ? descriptionFromPage(await response.text()) : undefined,
			)
			.catch(() => undefined);
		if (value === undefined) return null;

		this.descriptions.delete(url);
		this.descriptions.set(url, { expires: Date.now() + DESCRIPTION_TTL_MS, value });
		for (const oldKey of this.descriptions.keys()) {
			if (this.descriptions.size <= MAX_DESCRIPTIONS) break;
			this.descriptions.delete(oldKey);
		}
		return value;
	}

	private async get<T>(url: string, schema: z.ZodType<T>): Promise<T> {
		const cached = this.cache.get(url);
		if (cached && cached.expires > Date.now()) return cached.value as T;

		const response = await this.http(url, {
			headers: { Accept: 'application/json', 'User-Agent': 'skillpouch' },
			signal: AbortSignal.timeout(10_000),
		}).catch((cause: unknown) => {
			throw new AppError('upstream_unavailable', { service: 'skills.sh' }, { cause });
		});
		if (!response.ok) {
			throw new AppError('upstream_unavailable', {
				service: 'skills.sh',
				status: response.status,
			});
		}
		const parsed = schema.safeParse(await response.json().catch(() => null));
		if (!parsed.success) {
			throw new AppError('upstream_unavailable', {
				service: 'skills.sh',
				reason: 'unexpected response',
			});
		}
		this.cache.delete(url);
		this.cache.set(url, { expires: Date.now() + CACHE_TTL_MS, value: parsed.data });
		for (const oldKey of this.cache.keys()) {
			if (this.cache.size <= MAX_CACHED) break;
			this.cache.delete(oldKey);
		}
		return parsed.data;
	}
}
