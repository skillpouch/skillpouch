// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Per-route configuration (plan 06 §2.1). Every route must declare
 * `config.auth`; the server refuses to boot otherwise.
 */
import type { Principal } from '../security/principal';

export type AuthMode = 'public' | 'session' | 'device' | 'any' | 'admin';

export type RateLimitBucket = 'auth' | 'general' | 'operations' | 'blobs';

export interface SkillpouchRouteConfig {
	auth: AuthMode;
	/** Session routes usable before the browser key is bound (bind itself, `/v1/me`). */
	allowUnbound?: boolean;
	/** Requires a fresh OAuth sign-in for web sessions (08 §5.3). */
	stepUp?: boolean;
	/** Response is not wrapped in the envelope (17 §2 exceptions). */
	raw?: boolean;
	/** Mutating route held/blocked by the write pause even though it is GET. */
	rateLimit?: RateLimitBucket;
	/**
	 * CLI devices may call this route for a `locked` pouch. Every other route
	 * that names a pouch (`:pouchId` or body `pouch_id`) answers a device with
	 * `pouch_locked` — locked pouches are not synced (18 §3.3).
	 */
	lockedPouchOk?: boolean;
}

declare module 'fastify' {
	interface FastifyContextConfig {
		auth?: AuthMode;
		allowUnbound?: boolean;
		stepUp?: boolean;
		raw?: boolean;
		rateLimit?: RateLimitBucket;
		lockedPouchOk?: boolean;
	}
	interface FastifyRequest {
		principal: Principal | null;
		/** Raw DPoP proof verification result for routes that need the key itself. */
		dpopJkt: string | null;
	}
}
