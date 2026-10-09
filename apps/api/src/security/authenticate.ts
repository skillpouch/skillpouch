// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Authentication & request guards.
 *
 * Hook order: request id → write pause → authenticate → step-up → rate limit
 * → route. A route without `config.auth` makes the server refuse to boot.
 *
 *  device  — `Authorization: DPoP <access token>` + DPoP proof from the
 *            device key; token version checked against the database on every
 *            request (≤ 1 s cache) so a revoke is effective immediately.
 *  session — Better Auth cookie + DPoP proof from the browser key the session
 *            was bound to; Origin + `Skillpouch-Client: web` on writes (CSRF).
 *  any     — device if an `Authorization: DPoP` header is present, else session.
 *  admin   — session with role = admin.
 */
import { TtlCache } from '../lib/ttl-cache';
import { Limits } from '@skillpouch/contracts';
import { accountMembers, dpopReplay, pouches, storageAccounts } from '@skillpouch/db';
import { fromNodeHeaders } from 'better-auth/node';
import { eq, sql } from 'drizzle-orm';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Deps } from '../deps';
import { AppError } from '../http/app-error';
import { ensureStorageAccount } from '../modules/account/account.service';
import { verifyDpopProof, type DpopExpectation, type DpopResult } from './dpop';
import { hashIp } from './crypto-util';
import type { DevicePrincipal, SessionPrincipal } from './principal';
import { BUCKETS, takeToken } from './rate-limit';
import { withTenantTx } from './tenant-tx';

const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const WRITE_PAUSE_MAX_WAIT_MS = 10_000;
/** Routes registered by plugins we trust that have no `config.auth`. */
const EXEMPT_PREFIXES = ['/docs'];

export function requestUrl(deps: Deps, request: FastifyRequest): string {
	const base = deps.env.API_PUBLIC_URL.replace(/\/+$/, '');
	return `${base}${request.url.split('?')[0]}`;
}

/** Verifies the request's DPoP proof (used by guards and by routes such as bind/cli-auth). */
export function verifyRequestDpop(
	deps: Deps,
	request: FastifyRequest,
	accessToken?: string,
): Promise<DpopResult> {
	const expected: DpopExpectation = { method: request.method, url: requestUrl(deps, request) };
	if (accessToken !== undefined) expected.accessToken = accessToken;
	const header = request.headers.dpop;
	return verifyDpopProof(typeof header === 'string' ? header : undefined, expected, {
		nonces: deps.nonces,
		now: deps.now,
		recordJti: async (jti, expiresAt) => {
			const rows = await deps.db.app
				.insert(dpopReplay)
				.values({ jti, expiresAt })
				.onConflictDoNothing()
				.returning({ jti: dpopReplay.jti });
			return rows.length === 1;
		},
	});
}

/** The account's trusted-browser window in days, clamped to 7–90. */
export function browserTrustDays(settings: Record<string, unknown> | null | undefined): number {
	const value = Number(settings?.browser_trust_days ?? Limits.browserTrustDaysDefault);
	if (!Number.isInteger(value)) return Limits.browserTrustDaysDefault;
	return Math.min(Limits.browserTrustDaysMax, Math.max(Limits.browserTrustDaysMin, value));
}

export function clientIpHash(deps: Deps, request: FastifyRequest): Buffer {
	return hashIp(deps.env.IP_HASH_SECRET, request.ip);
}

async function authenticateDevice(deps: Deps, request: FastifyRequest): Promise<DevicePrincipal> {
	const authorization = request.headers.authorization ?? '';
	if (!authorization.startsWith('DPoP ')) throw new AppError('unauthenticated');
	const accessToken = authorization.slice(5).trim();
	const claims = await deps.tokens.verify(accessToken);
	const proof = await verifyRequestDpop(deps, request, accessToken);
	if (proof.jkt !== claims.jkt) throw new AppError('dpop_invalid', { reason: 'key mismatch' });

	const status = await deps.deviceStatus.get(claims.sa, claims.did);
	if (!status) throw new AppError('token_invalid');
	if (
		status.state === 'revoked' ||
		status.tokenVersion !== claims.ver ||
		!status.keys.has(proof.jkt)
	) {
		throw new AppError('device_revoked');
	}
	if (status.state === 'suspended') throw new AppError('device_suspended');
	if (status.userSuspended) throw new AppError('account_suspended');

	return {
		kind: 'device',
		userId: status.userId,
		storageAccountId: claims.sa,
		deviceId: claims.did,
		memberId: status.memberId,
		jkt: proof.jkt,
		publicJwk: proof.jwk,
	};
}

async function authenticateSession(
	deps: Deps,
	request: FastifyRequest,
	allowUnbound: boolean,
): Promise<SessionPrincipal> {
	const result = await deps.auth.api.getSession({ headers: fromNodeHeaders(request.headers) });
	if (!result) throw new AppError('unauthenticated');
	const { session, user } = result as unknown as {
		session: { id: string; jkt?: string | null; stepUpAt?: Date | string | null };
		user: {
			id: string;
			email: string;
			role?: string | null;
			suspendedAt?: Date | string | null;
		};
	};
	if (user.suspendedAt) throw new AppError('account_suspended');

	if (UNSAFE_METHODS.has(request.method)) {
		const client = request.headers['skillpouch-client'];
		if (
			request.headers.origin !== deps.env.WEB_ORIGIN ||
			typeof client !== 'string' ||
			!client.startsWith('web')
		) {
			throw new AppError('csrf_rejected');
		}
	}

	const storageAccountId = await ensureStorageAccount(deps.db.app, user.id);
	const jkt = session.jkt ?? null;
	let memberId: string | null = null;
	let trustExpired = false;
	let expiredMemberId: string | null = null;
	if (jkt) {
		const proof = await verifyRequestDpop(deps, request);
		if (proof.jkt !== jkt)
			throw new AppError('dpop_invalid', { reason: 'session key mismatch' });
		const member = await withTenantTx(deps.db.app, storageAccountId, async (tx) => {
			const [row] = await tx
				.select({
					id: accountMembers.id,
					revokedAt: accountMembers.revokedAt,
					removedSeq: accountMembers.removedSeq,
					lastSeenAt: accountMembers.lastSeenAt,
					trustExpiredAt: accountMembers.trustExpiredAt,
					settings: storageAccounts.securitySettings,
				})
				.from(accountMembers)
				.innerJoin(storageAccounts, eq(storageAccounts.id, accountMembers.storageAccountId))
				.where(eq(accountMembers.sessionJkt, jkt));
			if (!row || row.revokedAt || row.removedSeq !== null) return row;
			const now = deps.now();
			const trustMs = browserTrustDays(row.settings) * 86_400_000;
			const lastUsed = row.lastSeenAt ?? now;
			if (!row.trustExpiredAt && now.getTime() - lastUsed.getTime() > trustMs) {
				// Unused longer than the trust window: unlock again.
				await tx
					.update(accountMembers)
					.set({ trustExpiredAt: now })
					.where(eq(accountMembers.id, row.id));
				return { ...row, trustExpiredAt: now };
			}
			if (!row.trustExpiredAt && now.getTime() - lastUsed.getTime() > 60_000) {
				await tx
					.update(accountMembers)
					.set({ lastSeenAt: now })
					.where(eq(accountMembers.id, row.id));
			}
			return row;
		});
		if (member && (member.revokedAt || member.removedSeq !== null))
			throw new AppError('device_revoked');
		trustExpired = member?.trustExpiredAt != null;
		expiredMemberId = trustExpired ? member!.id : null;
		memberId = member && !trustExpired ? member.id : null;
	} else if (!allowUnbound) {
		throw new AppError('session_unbound');
	}

	return {
		kind: 'session',
		userId: user.id,
		email: user.email,
		role: user.role === 'admin' ? 'admin' : 'user',
		storageAccountId,
		sessionId: session.id,
		jkt,
		memberId,
		trustExpiredMemberId: trustExpired ? expiredMemberId : null,
		stepUpAt: session.stepUpAt ? new Date(session.stepUpAt) : null,
	};
}

async function waitForWritePause(deps: Deps): Promise<void> {
	const deadline = Date.now() + WRITE_PAUSE_MAX_WAIT_MS;
	while (await deps.settings.isWritePaused()) {
		if (Date.now() >= deadline)
			throw new AppError('maintenance_write_pause', undefined, {
				headers: { 'Retry-After': '5' },
			});
		await new Promise((resolve) => setTimeout(resolve, 500));
		deps.settings.invalidate();
	}
}

export function isStepUpFresh(principal: SessionPrincipal, now: Date): boolean {
	return (
		principal.stepUpAt !== null &&
		now.getTime() - principal.stepUpAt.getTime() <= Limits.stepUpMaxAgeSeconds * 1000
	);
}

export async function registerAuthentication(app: FastifyInstance, deps: Deps): Promise<void> {
	app.decorateRequest('principal', null);
	app.decorateRequest('dpopJkt', null);

	app.addHook('onRoute', (route) => {
		if (EXEMPT_PREFIXES.some((prefix) => route.url.startsWith(prefix))) return;
		if (!route.config?.auth) {
			// eslint-disable-next-line no-restricted-syntax -- boot-time wiring bug, not a request error
			throw new Error(`Route ${String(route.method)} ${route.url} is missing config.auth`);
		}
	});

	// Every response carries a fresh nonce so clients rarely hit dpop_nonce_required.
	app.addHook('onSend', async (request, reply) => {
		reply.header('DPoP-Nonce', deps.nonces.current());
		// Admin answers hold other people's details: never kept by a cache.
		if (request.routeOptions.config?.auth === 'admin')
			reply.header('Cache-Control', 'no-store');
	});

	app.addHook('onRequest', async (request) => {
		const config = request.routeOptions.config;
		const mode = config?.auth;
		if (!mode) return;

		if (UNSAFE_METHODS.has(request.method) && mode !== 'public') await waitForWritePause(deps);

		switch (mode) {
			case 'public':
				break;
			case 'device':
				request.principal = await authenticateDevice(deps, request);
				break;
			case 'session':
				request.principal = await authenticateSession(
					deps,
					request,
					config.allowUnbound === true,
				);
				break;
			case 'admin': {
				const principal = await authenticateSession(deps, request, false);
				if (principal.role !== 'admin') throw new AppError('forbidden');
				request.principal = principal;
				break;
			}
			case 'any':
				request.principal = request.headers.authorization?.startsWith('DPoP ')
					? await authenticateDevice(deps, request)
					: await authenticateSession(deps, request, config.allowUnbound === true);
				break;
		}

		const principal = request.principal;
		if (
			config.stepUp &&
			principal?.kind === 'session' &&
			!isStepUpFresh(principal, deps.now())
		) {
			throw new AppError('step_up_required', { max_age_seconds: Limits.stepUpMaxAgeSeconds });
		}
		if (
			mode === 'admin' &&
			UNSAFE_METHODS.has(request.method) &&
			principal?.kind === 'session'
		) {
			if (!isStepUpFresh(principal, deps.now())) throw new AppError('step_up_required');
		}

		const bucket =
			config.rateLimit ??
			(mode === 'public' ? 'public' : mode === 'admin' ? 'admin' : 'general');
		if (deps.env.RATE_LIMIT_ENABLED && bucket) {
			const subject = principal
				? principal.kind === 'device'
					? `d:${principal.deviceId}`
					: `u:${principal.userId}`
				: `ip:${clientIpHash(deps, request).toString('base64url')}`;
			const retryAfter = await takeToken(
				deps.db.app,
				`${bucket}:${subject}`,
				BUCKETS[bucket],
			);
			if (retryAfter > 0) {
				throw new AppError('rate_limited', undefined, {
					headers: { 'Retry-After': String(retryAfter) },
				});
			}
		}
	});

	// After validation: params/body are parsed, so the pouch id is trustworthy here.
	// Writes re-check the pouch state inside their own transaction; this gate keeps
	// devices off locked pouches for reads too. States are cached for 3 s and
	// dropped as soon as any pouch changes state (the notification reaches
	// every instance).
	const pouchStates = new TtlCache<string | null>(3000, 20_000);
	const stopWatching = deps.hub.onAccountEvent((event) => {
		if (event.type === 'pouch.state_changed' || event.type === 'entitlements.changed') {
			pouchStates.clear();
		}
	});
	app.addHook('onClose', async () => stopWatching());
	app.addHook('preHandler', async (request) => {
		const principal = request.principal;
		if (principal?.kind !== 'device' || request.routeOptions.config?.lockedPouchOk) return;
		const pouchId = pouchIdOf(request);
		if (!pouchId) return;
		const state = await pouchStates.get(pouchId, async () => {
			const [row] = await withTenantTx(deps.db.app, principal.storageAccountId, (tx) =>
				tx.select({ state: pouches.state }).from(pouches).where(eq(pouches.id, pouchId)),
			);
			return row?.state ?? null;
		});
		if (state === 'locked') throw new AppError('pouch_locked');
	});
}

/** The pouch a request is about: `:pouchId` in the path or `pouch_id` in the body. */
function pouchIdOf(request: FastifyRequest): string | null {
	const params = request.params as { pouchId?: unknown } | undefined;
	if (typeof params?.pouchId === 'string') return params.pouchId;
	const body = request.body as { pouch_id?: unknown } | undefined;
	if (body && typeof body === 'object' && typeof body.pouch_id === 'string') return body.pouch_id;
	return null;
}

/**
 * Marks a device as seen at most once a minute per instance. Entries older
 * than that window are useless, so the map is cleared of them as it grows.
 */
const lastSeenWrites = new Map<string, number>();
const LAST_SEEN_WINDOW_MS = 60_000;
const LAST_SEEN_PRUNE_AT = 10_000;
export async function touchDevice(deps: Deps, principal: DevicePrincipal): Promise<void> {
	const now = Date.now();
	const last = lastSeenWrites.get(principal.deviceId) ?? 0;
	if (now - last < LAST_SEEN_WINDOW_MS) return;
	if (lastSeenWrites.size >= LAST_SEEN_PRUNE_AT) {
		for (const [deviceId, at] of lastSeenWrites) {
			if (now - at >= LAST_SEEN_WINDOW_MS) lastSeenWrites.delete(deviceId);
		}
	}
	lastSeenWrites.set(principal.deviceId, now);
	await withTenantTx(deps.db.app, principal.storageAccountId, (tx) =>
		tx.execute(sql`UPDATE devices SET last_seen_at = now() WHERE id = ${principal.deviceId}`),
	);
}
