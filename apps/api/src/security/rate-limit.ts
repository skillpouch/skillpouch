// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Postgres token-bucket rate limiter: one upsert per check keeps
 * the API stateless across replicas.
 */
import type { Database } from '@skillpouch/db';
import { sql } from 'drizzle-orm';
import type { RateLimitBucket } from '../http/route-config';

export interface BucketPolicy {
	/** Maximum burst. */
	capacity: number;
	/** Tokens added per minute. */
	perMinute: number;
}

export const BUCKETS: Record<RateLimitBucket, BucketPolicy> = {
	auth: { capacity: 10, perMinute: 10 },
	general: { capacity: 300, perMinute: 300 },
	operations: { capacity: 120, perMinute: 120 },
	blobs: { capacity: 600, perMinute: 600 },
	/** GitHub scans: each one can fetch hundreds of files upstream. */
	import: { capacity: 10, perMinute: 10 },
	/** Marketplace browsing: searches as you type, items read one at a time. */
	marketplace: { capacity: 60, perMinute: 60 },
	/** Unauthenticated routes (share links, request cancel), per IP. */
	public: { capacity: 120, perMinute: 120 },
};

/** Takes one token; returns the seconds to wait when the bucket is empty, else 0. */
export async function takeToken(db: Database, key: string, policy: BucketPolicy): Promise<number> {
	const perSecond = policy.perMinute / 60;
	const result = await db.execute(sql`
		INSERT INTO rate_limits (key, tokens, refilled_at)
		VALUES (${key}, ${policy.capacity - 1}, now())
		ON CONFLICT (key) DO UPDATE SET
			tokens = GREATEST(-1, LEAST(${policy.capacity}::float8,
				rate_limits.tokens + EXTRACT(EPOCH FROM (now() - rate_limits.refilled_at)) * ${perSecond}::float8) - 1),
			refilled_at = now()
		RETURNING tokens`);
	const tokens = Number(result.rows[0]?.tokens ?? 0);
	return tokens >= 0 ? 0 : Math.ceil(1 / perSecond);
}
