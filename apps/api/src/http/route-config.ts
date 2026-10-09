// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Per-route configuration. Every route must declare
 * `config.auth`; the server refuses to boot otherwise.
 */
import type { Principal } from '../security/principal';

export type AuthMode = 'public' | 'session' | 'device' | 'any' | 'admin';

/**
 * Token buckets. Public routes without an explicit bucket use `public`
 * (keyed by client IP).
 */
export type RateLimitBucket =
	'admin' | 'auth' | 'general' | 'operations' | 'blobs' | 'import' | 'marketplace' | 'public';

export interface SkillpouchRouteConfig {
	auth: AuthMode;
	/** Session routes usable before the browser key is bound (bind itself, `/v1/me`). */
	allowUnbound?: boolean;
	/** Requires a fresh OAuth sign-in for web sessions. */
	stepUp?: boolean;
	/** Response is not wrapped in the envelope. */
	raw?: boolean;
	/** Mutating route held/blocked by the write pause even though it is GET. */
	/** `false`: never rate limited (health probes). */
	rateLimit?: RateLimitBucket | false;
	/**
	 * CLI devices may call this route for a `locked` pouch. Every other route
	 * that names a pouch (`:pouchId` or body `pouch_id`) answers a device with
	 * `pouch_locked` — locked pouches are not synced.
	 */
	lockedPouchOk?: boolean;
}

declare module 'fastify' {
	interface FastifyContextConfig {
		auth?: AuthMode;
		allowUnbound?: boolean;
		stepUp?: boolean;
		raw?: boolean;
		rateLimit?: RateLimitBucket | false;
		lockedPouchOk?: boolean;
	}
	interface FastifyRequest {
		principal: Principal | null;
		/** Raw DPoP proof verification result for routes that need the key itself. */
		dpopJkt: string | null;
	}
}
