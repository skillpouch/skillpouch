// SPDX-License-Identifier: AGPL-3.0-only
/**
 * "Authorize CLI" login — browser first, CLI second.
 *
 *   1. CLI: POST /v1/cli-auth/requests with its public keys, a PKCE challenge
 *      and a DPoP proof made by its signing key.
 *   2. Browser (signed in + unlocked): shows the request, the user clicks
 *      Authorize; the page signs the roster `add` and seals the welcome.
 *   3. CLI long-polls POST /v1/cli-auth/token with the PKCE verifier and a DPoP
 *      proof from the same key → tokens + welcome.
 *
 * A stolen request id is useless: redeeming needs the PKCE verifier and the
 * CLI's private key.
 *
 * Shortcut — "Connect a computer": the unlocked browser creates a one-time
 * connect token, the user runs `npx skillpouch login <token>`, the CLI sends
 * it with step 1. The request is then bound to that account and the waiting
 * browser authorizes it without the user opening a link.
 */
import { createHash, randomUUID } from 'node:crypto';
import { blake3 } from '@noble/hashes/blake3.js';
import {
	Limits,
	canonicalJson,
	fromBase64Url,
	toBase64Url,
	type CliAuthApprove,
	type CliAuthCreate,
} from '@skillpouch/contracts';
import {
	cliAuthRequests,
	cliConnectTokens,
	deviceKeys,
	devices,
	securityEvents,
} from '@skillpouch/db';
import { and, eq, gt, isNull, sql } from 'drizzle-orm';
import type { z } from 'zod';
import type { Deps } from '../../deps';
import { AppError } from '../../http/app-error';
import { addSeconds } from '../../lib/dates';
import { uuidv7 } from '../../lib/ids';
import { notifyAccount } from '../../infra/notify';
import { appendAudit } from '../../security/audit';
import { bytesEqualBuffers, randomToken, sha256 } from '../../security/crypto-util';
import { jwkThumbprint } from '../../security/dpop';
import { parseRosterStatement, samePublicKey } from '../../security/e2ee-structure';
import type { SessionPrincipal } from '../../security/principal';
import { principalLabel } from '../../security/principal';
import { withTenantTx } from '../../security/tenant-tx';
import { issueDeviceTokens } from '../devices/devices.service';
import {
	appendStatements,
	assertEnvelopeCoverage,
	insertKeyEnvelopes,
} from '../roster/roster.service';

type RequestRow = typeof cliAuthRequests.$inferSelect;

/**
 * The 8-digit code the CLI prints and the browser shows: BLAKE3 over the
 * request id and the CLI's keys. Must match `confirmCode` in @skillpouch/crypto.
 */
export function cliConfirmCode(row: {
	id: string;
	signPub: object;
	encPub: object;
	jkt: string;
}): string {
	const digest = blake3(
		Buffer.concat([
			Buffer.from('skillpouch/v1/cli-confirm'),
			Buffer.from(row.id),
			Buffer.from(canonicalJson(row.signPub)),
			Buffer.from(canonicalJson(row.encPub)),
			Buffer.from(row.jkt),
		]),
	);
	const value = Buffer.from(digest).readBigUInt64BE(0);
	const digits = (value % 100_000_000n).toString().padStart(8, '0');
	return `${digits.slice(0, 4)}-${digits.slice(4)}`;
}

const MAX_OPEN_PER_IP = 5;
const POLL_INTERVAL_MS = 400;

export async function createCliAuthRequest(
	deps: Deps,
	input: z.infer<typeof CliAuthCreate>,
	proofJkt: string,
	ipHash: Buffer,
) {
	if ((await jwkThumbprint(input.sign_pub)) !== proofJkt) {
		throw new AppError('dpop_invalid', { reason: 'proof must be signed by sign_pub' });
	}
	const id = randomUUID();
	const values = {
		id,
		codeChallenge: Buffer.from(fromBase64Url(input.code_challenge)),
		jkt: proofJkt,
		signPub: { ...input.sign_pub },
		encPub: { ...input.enc_pub },
		keyStorage: input.key_storage,
		deviceName: input.device_name,
		os: input.os,
		arch: input.arch,
		cliVersion: input.cli_version,
		assistants: input.assistants,
		ipHash,
		expiresAt: addSeconds(deps.now(), Limits.cliAuthTtlSeconds),
	};
	await deps.db.app.transaction(async (tx) => {
		// Count and insert under one per-IP lock, so parallel requests can't overshoot the cap.
		await tx.execute(
			sql`SELECT pg_advisory_xact_lock(hashtextextended(${'cli-auth:' + ipHash.toString('base64url')}, 0))`,
		);
		const open = await tx.execute(
			sql`SELECT count(*)::int AS n FROM cli_auth_requests WHERE ip_hash = ${ipHash} AND state = 'open' AND expires_at > now()`,
		);
		if (Number(open.rows[0]?.n ?? 0) >= MAX_OPEN_PER_IP) throw new AppError('rate_limited');

		if (!input.connect_token) {
			await tx.insert(cliAuthRequests).values(values);
			return;
		}
		const [token] = await tx
			.update(cliConnectTokens)
			.set({ usedAt: deps.now(), requestId: id })
			.where(
				and(
					eq(cliConnectTokens.tokenHash, sha256(input.connect_token)),
					isNull(cliConnectTokens.usedAt),
					gt(cliConnectTokens.expiresAt, deps.now()),
				),
			)
			.returning();
		if (!token) throw new AppError('connect_token_invalid');
		await tx.insert(cliAuthRequests).values({
			...values,
			storageAccountId: token.storageAccountId,
			connectTokenId: token.id,
		});
		await notifyAccount(tx, token.storageAccountId, 'cli_auth.requested', {
			request_id: id,
			connect_token_id: token.id,
		});
	});
	return {
		request_id: id,
		authorize_url: `${deps.env.WEB_ORIGIN}/cli/authorize?request=${id}`,
		expires_in: Limits.cliAuthTtlSeconds,
		interval: 2,
	};
}

async function loadRequest(deps: Deps, id: string, lock = false): Promise<RequestRow> {
	const query = deps.db.app.select().from(cliAuthRequests).where(eq(cliAuthRequests.id, id));
	const [row] = lock ? await query.for('update') : await query;
	if (!row) throw new AppError('not_found');
	return row;
}

function isExpired(deps: Deps, row: RequestRow): boolean {
	return row.state === 'open' && row.expiresAt <= deps.now();
}

export function requestView(row: RequestRow, deps: Deps) {
	return {
		request_id: row.id,
		state: isExpired(deps, row) ? ('expired' as const) : row.state,
		device_name: row.deviceName,
		os: row.os,
		arch: row.arch,
		cli_version: row.cliVersion,
		assistants: row.assistants,
		key_storage: row.keyStorage,
		sign_pub: row.signPub as { kty: 'EC'; crv: 'P-256'; x: string; y: string },
		enc_pub: row.encPub as { kty: 'EC'; crv: 'P-256'; x: string; y: string },
		jkt: row.jkt,
		via_connect_token: row.connectTokenId !== null,
		geo: row.geo,
		created_at: row.createdAt.toISOString(),
		expires_at: row.expiresAt.toISOString(),
	};
}

/** The authorize page loads a request. Requests already approved by another account are invisible. */
export async function getCliAuthRequest(deps: Deps, principal: SessionPrincipal, id: string) {
	const row = await loadRequest(deps, id);
	if (row.storageAccountId && row.storageAccountId !== principal.storageAccountId)
		throw new AppError('not_found');
	return requestView(row, deps);
}

/** "Authorize" click: creates the device, adds its roster member and stores its key envelopes — one transaction. */
export async function approveCliAuthRequest(
	deps: Deps,
	principal: SessionPrincipal,
	id: string,
	input: z.infer<typeof CliAuthApprove>,
	ipHash: Buffer,
) {
	if (!principal.memberId)
		throw new AppError('member_inactive', { reason: 'unlock this browser first' });
	return withTenantTx(deps.db.app, principal.storageAccountId, async (tx) => {
		const [row] = await tx
			.select()
			.from(cliAuthRequests)
			.where(eq(cliAuthRequests.id, id))
			.for('update');
		if (!row || (row.storageAccountId && row.storageAccountId !== principal.storageAccountId)) {
			throw new AppError('not_found');
		}
		if (row.state !== 'open') throw new AppError('cli_auth_final', { state: row.state });
		if (isExpired(deps, row)) throw new AppError('cli_auth_expired');
		// A link can come from anyone; only the person at that terminal knows its code.
		if (!row.connectTokenId) {
			const typed = input.confirm_code?.replace('-', '');
			const expected = cliConfirmCode(row).replace('-', '');
			if (!typed || !bytesEqualBuffers(Buffer.from(typed), Buffer.from(expected))) {
				throw new AppError('cli_auth_code_mismatch');
			}
		}

		const statement = parseRosterStatement(input.statement.statement).body;
		const member = statement.member;
		if (
			statement.action !== 'add' ||
			!member ||
			member.kind !== 'device' ||
			!samePublicKey(member.sign_pub, row.signPub) ||
			!samePublicKey(member.enc_pub, row.encPub)
		) {
			throw new AppError('roster_invalid', {
				reason: 'statement must add exactly this CLI’s keys',
			});
		}

		const deviceId = uuidv7();
		await tx.insert(devices).values({
			id: deviceId,
			storageAccountId: principal.storageAccountId,
			userId: principal.userId,
			name: row.deviceName,
			os: row.os,
			arch: row.arch,
			cliVersion: row.cliVersion,
			assistants: row.assistants,
			authorizedFrom: principal.memberId,
			refreshHash: sha256(randomToken(32)),
			refreshFamilyId: randomUUID(),
			registeredIpHash: row.ipHash,
		});
		await tx.insert(deviceKeys).values({
			storageAccountId: principal.storageAccountId,
			deviceId,
			jkt: row.jkt,
			publicJwk: row.signPub,
			keyStorage: row.keyStorage,
		});
		await appendStatements(tx, [input.statement], {
			storageAccountId: principal.storageAccountId,
			requiredSigner: principal.memberId,
			allowedActions: new Set(['add']),
			deviceIdForNewMember: deviceId,
		});
		await insertKeyEnvelopes(tx, principal.storageAccountId, input.key_envelopes);
		await assertEnvelopeCoverage(tx);

		await tx
			.update(cliAuthRequests)
			.set({
				state: 'approved',
				storageAccountId: principal.storageAccountId,
				approvedByMember: principal.memberId,
				deviceId,
				welcome: Buffer.from(fromBase64Url(input.welcome)),
				finalizedAt: deps.now(),
			})
			.where(eq(cliAuthRequests.id, id));
		await tx.insert(securityEvents).values({
			storageAccountId: principal.storageAccountId,
			kind: 'cli.authorized',
			severity: 'info',
			details: { device_id: deviceId, device_name: row.deviceName, os: row.os },
		});
		await appendAudit(tx, {
			storageAccountId: principal.storageAccountId,
			actor: principalLabel(principal),
			action: 'cli.authorized',
			target: `device:${deviceId}`,
			ipHash,
		});
		await notifyAccount(tx, principal.storageAccountId, 'cli_auth.approved', {
			device_id: deviceId,
		});
		return { device_id: deviceId };
	});
}

export async function denyCliAuthRequest(deps: Deps, principal: SessionPrincipal, id: string) {
	await withTenantTx(deps.db.app, principal.storageAccountId, async (tx) => {
		const [row] = await tx
			.select()
			.from(cliAuthRequests)
			.where(eq(cliAuthRequests.id, id))
			.for('update');
		if (!row || (row.storageAccountId && row.storageAccountId !== principal.storageAccountId)) {
			throw new AppError('not_found');
		}
		if (row.state === 'denied') return;
		if (row.state !== 'open') throw new AppError('cli_auth_final', { state: row.state });
		await tx
			.update(cliAuthRequests)
			.set({
				state: 'denied',
				storageAccountId: principal.storageAccountId,
				finalizedAt: deps.now(),
			})
			.where(eq(cliAuthRequests.id, id));
		await appendAudit(tx, {
			storageAccountId: principal.storageAccountId,
			actor: principalLabel(principal),
			action: 'cli.denied',
			target: `cli_auth_request:${id}`,
		});
	});
	return {};
}

/** CLI redeems the request: PKCE + same DPoP key, long-polling up to `wait` seconds. */
export async function redeemCliAuthRequest(
	deps: Deps,
	input: { request_id: string; code_verifier: string; wait: number },
	proofJkt: string,
	signal: AbortSignal,
) {
	const initial = await loadRequest(deps, input.request_id);
	const challenge = createHash('sha256').update(input.code_verifier).digest();
	if (!bytesEqualBuffers(challenge, initial.codeChallenge)) throw new AppError('pkce_invalid');
	if (proofJkt !== initial.jkt)
		throw new AppError('dpop_invalid', { reason: 'not the requesting key' });

	const deadline = Date.now() + input.wait * 1000;
	for (;;) {
		const row = await loadRequest(deps, input.request_id);
		if (row.state === 'denied') throw new AppError('cli_auth_denied');
		if (row.state === 'redeemed') throw new AppError('cli_auth_final');
		if (row.state === 'expired' || isExpired(deps, row)) {
			await deps.db.app
				.update(cliAuthRequests)
				.set({ state: 'expired', finalizedAt: deps.now() })
				.where(and(eq(cliAuthRequests.id, row.id), eq(cliAuthRequests.state, 'open')));
			throw new AppError('cli_auth_expired');
		}
		if (row.state === 'approved') return finishRedeem(deps, row.id);
		if (Date.now() >= deadline || signal.aborted)
			return { status: 'pending' as const, interval: 2 };
		await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
	}
}

async function finishRedeem(deps: Deps, id: string) {
	// Claim the approved request exactly once; a concurrent second redeem gets cli_auth_final.
	const claimed = await deps.db.app.transaction(async (tx) => {
		const [row] = await tx
			.select()
			.from(cliAuthRequests)
			.where(eq(cliAuthRequests.id, id))
			.for('update');
		if (
			!row ||
			row.state !== 'approved' ||
			!row.deviceId ||
			!row.storageAccountId ||
			!row.welcome
		)
			return null;
		await tx
			.update(cliAuthRequests)
			.set({ state: 'redeemed', welcome: null })
			.where(eq(cliAuthRequests.id, id));
		return row;
	});
	if (!claimed) throw new AppError('cli_auth_final');
	const deviceId = claimed.deviceId!;
	const tokens = await withTenantTx(deps.db.app, claimed.storageAccountId!, async (tx) => {
		const [device] = await tx
			.select()
			.from(devices)
			.where(eq(devices.id, deviceId))
			.for('update');
		if (!device || device.state !== 'active') throw new AppError('device_revoked');
		return issueDeviceTokens(deps, tx, device, claimed.jkt, { newFamily: true });
	});
	return { status: 'approved' as const, ...tokens, welcome: toBase64Url(claimed.welcome!) };
}

/** CLI cancels its own pending request (Ctrl-C). */
export async function cancelCliAuthRequest(deps: Deps, id: string, proofJkt: string) {
	const row = await loadRequest(deps, id);
	if (row.jkt !== proofJkt) throw new AppError('not_found');
	await deps.db.app
		.update(cliAuthRequests)
		.set({ state: 'expired', finalizedAt: deps.now() })
		.where(and(eq(cliAuthRequests.id, id), eq(cliAuthRequests.state, 'open')));
	return {};
}

const CONNECT_TOKEN_PREFIX = 'sp_lt_';

/** "Connect a computer": a one-time token the user pastes into `npx skillpouch login`. */
export async function createConnectToken(deps: Deps, principal: SessionPrincipal) {
	if (!principal.memberId)
		throw new AppError('member_inactive', { reason: 'unlock this browser first' });
	const id = randomUUID();
	const token = CONNECT_TOKEN_PREFIX + randomToken(24);
	const expiresAt = addSeconds(deps.now(), Limits.connectTokenTtlSeconds);
	await deps.db.app.transaction(async (tx) => {
		await tx.execute(
			sql`SELECT pg_advisory_xact_lock(hashtextextended(${'connect-token:' + principal.storageAccountId}, 0))`,
		);
		const open = await tx.execute(
			sql`SELECT count(*)::int AS n FROM cli_connect_tokens
				WHERE storage_account_id = ${principal.storageAccountId}
					AND used_at IS NULL AND expires_at > now()`,
		);
		if (Number(open.rows[0]?.n ?? 0) >= Limits.connectTokensMaxOpen)
			throw new AppError('rate_limited');
		await tx.insert(cliConnectTokens).values({
			id,
			tokenHash: sha256(token),
			storageAccountId: principal.storageAccountId,
			createdByMember: principal.memberId!,
			expiresAt,
		});
	});
	return {
		id,
		token,
		command: `npx skillpouch login ${token}`,
		expires_at: expiresAt.toISOString(),
	};
}

async function loadConnectToken(deps: Deps, principal: SessionPrincipal, id: string) {
	const [row] = await deps.db.app
		.select()
		.from(cliConnectTokens)
		.where(
			and(
				eq(cliConnectTokens.id, id),
				eq(cliConnectTokens.storageAccountId, principal.storageAccountId),
			),
		);
	if (!row) throw new AppError('not_found');
	return row;
}

/** Fallback for browsers that missed the `cli_auth.requested` event. */
export async function getConnectToken(deps: Deps, principal: SessionPrincipal, id: string) {
	const row = await loadConnectToken(deps, principal, id);
	const state = row.requestId
		? ('requested' as const)
		: row.expiresAt <= deps.now()
			? ('expired' as const)
			: ('waiting' as const);
	return {
		id: row.id,
		state,
		request_id: row.requestId,
		expires_at: row.expiresAt.toISOString(),
	};
}

/** "New token" or closing the dialog: an unused token stops working at once. */
export async function revokeConnectToken(deps: Deps, principal: SessionPrincipal, id: string) {
	await loadConnectToken(deps, principal, id);
	await deps.db.app
		.update(cliConnectTokens)
		.set({ expiresAt: deps.now() })
		.where(and(eq(cliConnectTokens.id, id), isNull(cliConnectTokens.usedAt)));
	return {};
}
