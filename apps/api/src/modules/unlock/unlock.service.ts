// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Unlocking content in a browser (plan 15 §4.1, §8).
 *
 * The server never sees the master password, a passkey's PRF output or the
 * Recovery Key — it cannot: those secrets *derive* member key pairs in the
 * browser. What the server does:
 *
 *  - keeps the Argon2id salt/params and the sealed per-account pepper, and
 *    releases the pepper to a bound web session at most 10×/hour, 30×/day
 *    (throttles online guessing; a DB thief cannot guess offline at all);
 *  - releases the key envelopes of a secret-derived member only to a session
 *    that proved the secret (pepper release / passkey assertion — the
 *    Recovery Key is 256 bits and needs no throttle);
 *  - accepts the new browser's self-enrollment, whose `add` statement is
 *    signed with the unlocking member's derived key (that signature *is* the
 *    proof of the secret);
 *  - expires browser trust after the account's window (default 30 days).
 */
import { randomBytes } from 'node:crypto';
import {
	Limits,
	SECRET_MEMBER_KINDS,
	toBase64Url,
	type KdfParams,
	type KeyEnvelopeInput,
	type RosterStatementInput,
} from '@skillpouch/contracts';
import {
	accountMembers,
	accountUnlock,
	auditLog,
	keyEnvelopes,
	passkeyUnlockers,
	securityEvents,
	storageAccounts,
	unlockGrants,
} from '@skillpouch/db';
import { and, asc, count, eq, gt, isNull } from 'drizzle-orm';
import type { Deps } from '../../deps';
import { AppError } from '../../http/app-error';
import { notifyAccount } from '../../infra/notify';
import { addSeconds } from '../../lib/dates';
import { appendAudit } from '../../security/audit';
import { browserTrustDays } from '../../security/authenticate';
import { jwkThumbprint } from '../../security/dpop';
import {
	concatBytes,
	parseRosterStatement,
	verifyMemberSignature,
} from '../../security/e2ee-structure';
import { principalLabel, type SessionPrincipal } from '../../security/principal';
import { withTenantTx, type TenantTx } from '../../security/tenant-tx';
import {
	appendStatements,
	assertEnvelopeCoverage,
	insertKeyEnvelopes,
	isActiveMember,
	keyEnvelopeView,
	loadMembers,
} from '../roster/roster.service';

/** Argon2id defaults (15 §8.6): 64 MiB, 3 passes, 1 lane. Raised over time. */
export const DEFAULT_KDF_PARAMS: KdfParams = { alg: 'argon2id', m: 65_536, t: 3, p: 1 };

/** Context string of the "renew browser trust" proof signature. */
export const RENEW_TRUST_CONTEXT = 'skillpouch/v1/renew-trust';

const ROSTER_FOLLOW_UPS = new Set(['add', 'remove', 'rotate_keys']);

async function lockUnlockRow(tx: TenantTx, storageAccountId: string) {
	const [row] = await tx
		.select()
		.from(accountUnlock)
		.where(eq(accountUnlock.storageAccountId, storageAccountId))
		.for('update');
	return row;
}

async function hasGenesis(tx: TenantTx, storageAccountId: string): Promise<boolean> {
	const [account] = await tx
		.select({ genesisHash: storageAccounts.genesisHash })
		.from(storageAccounts)
		.where(eq(storageAccounts.id, storageAccountId));
	return account?.genesisHash != null;
}

/**
 * Creates fresh KDF salt + pepper as *pending* parameters. They become the
 * account's real parameters only when genesis (or a master-password change)
 * commits them, so an abandoned attempt changes nothing.
 */
export async function prepareUnlock(deps: Deps, principal: SessionPrincipal) {
	return withTenantTx(deps.db.app, principal.storageAccountId, async (tx) => {
		if (await hasGenesis(tx, principal.storageAccountId)) {
			// Changing the master password: only an unlocked browser after a fresh sign-in.
			if (!principal.memberId) throw new AppError('member_inactive');
		}
		const salt = randomBytes(16);
		const { pepper, sealed } = deps.pepper.create(principal.storageAccountId);
		const pending = {
			pendingKdfSalt: salt,
			pendingKdfParams: DEFAULT_KDF_PARAMS,
			pendingPepperCiphertext: sealed.ciphertext,
			pendingPepperKeyId: sealed.keyId,
			pendingCreatedAt: deps.now(),
			updatedAt: deps.now(),
		};
		await tx
			.insert(accountUnlock)
			.values({ storageAccountId: principal.storageAccountId, ...pending })
			.onConflictDoUpdate({ target: accountUnlock.storageAccountId, set: pending });
		await appendAudit(tx, {
			storageAccountId: principal.storageAccountId,
			actor: principalLabel(principal),
			action: 'unlock.prepared',
		});
		return {
			kdf_salt: toBase64Url(salt),
			kdf_params: DEFAULT_KDF_PARAMS,
			pepper: toBase64Url(pepper),
		};
	});
}

/** Promotes the pending parameters (inside genesis / password change transactions). */
export async function commitPendingUnlock(tx: TenantTx, storageAccountId: string, now: Date) {
	const row = await lockUnlockRow(tx, storageAccountId);
	if (!row?.pendingKdfSalt || !row.pendingPepperCiphertext || !row.pendingKdfParams) {
		throw new AppError('unlock_not_ready', {
			reason: 'call POST /v1/account/unlock/prepare first',
		});
	}
	await tx
		.update(accountUnlock)
		.set({
			kdfSalt: row.pendingKdfSalt,
			kdfParams: row.pendingKdfParams,
			pepperCiphertext: row.pendingPepperCiphertext,
			pepperKeyId: row.pendingPepperKeyId,
			pendingKdfSalt: null,
			pendingKdfParams: null,
			pendingPepperCiphertext: null,
			pendingPepperKeyId: null,
			pendingCreatedAt: null,
			failedStreak: 0,
			updatedAt: now,
		})
		.where(eq(accountUnlock.storageAccountId, storageAccountId));
}

/** Everything a browser needs to try passkey → master password → Recovery Key. */
export async function unlockParams(deps: Deps, principal: SessionPrincipal) {
	return withTenantTx(deps.db.app, principal.storageAccountId, async (tx) => {
		const [row] = await tx
			.select()
			.from(accountUnlock)
			.where(eq(accountUnlock.storageAccountId, principal.storageAccountId));
		const [account] = await tx
			.select({ settings: storageAccounts.securitySettings })
			.from(storageAccounts)
			.where(eq(storageAccounts.id, principal.storageAccountId));
		const order = { passkey: 0, password: 1, recovery: 2 } as Record<string, number>;
		const members = [...(await loadMembers(tx)).values()]
			.filter((member) => SECRET_MEMBER_KINDS.includes(member.kind) && isActiveMember(member))
			.sort((a, b) => order[a.kind]! - order[b.kind]!);
		const passkeys = await tx
			.select()
			.from(passkeyUnlockers)
			.orderBy(asc(passkeyUnlockers.createdAt));
		const activeIds = new Set(members.map((member) => member.id));
		return {
			state: row?.kdfSalt ? ('ready' as const) : ('setup_required' as const),
			kdf_salt: row?.kdfSalt ? toBase64Url(row.kdfSalt) : null,
			kdf_params: row?.kdfParams ?? null,
			members: members.map((member) => ({
				id: member.id,
				kind: member.kind,
				member_salt: member.memberSalt ? toBase64Url(member.memberSalt) : null,
			})),
			passkeys: passkeys
				.filter((passkey) => activeIds.has(passkey.memberId))
				.map(passkeyView),
			browser_trust_days: browserTrustDays(account?.settings),
			failed_streak: row?.failedStreak ?? 0,
		};
	});
}

export function passkeyView(row: typeof passkeyUnlockers.$inferSelect) {
	return {
		id: row.id,
		member_id: row.memberId,
		credential_id: toBase64Url(row.credentialId),
		transports: row.transports ?? [],
		label: row.label,
		created_at: row.createdAt.toISOString(),
		last_used_at: row.lastUsedAt?.toISOString() ?? null,
	};
}

/** Records that this web session proved the secret of `memberId` (15 §8.1). */
export async function grantUnlock(
	tx: TenantTx,
	principal: SessionPrincipal,
	memberId: string,
	now: Date,
): Promise<Date> {
	const expiresAt = addSeconds(now, Limits.unlockGrantSeconds);
	await tx
		.insert(unlockGrants)
		.values({
			storageAccountId: principal.storageAccountId,
			sessionId: principal.sessionId,
			memberId,
			expiresAt,
		})
		.onConflictDoUpdate({
			target: [unlockGrants.sessionId, unlockGrants.memberId],
			set: { expiresAt, createdAt: now },
		});
	return expiresAt;
}

async function releasesSince(tx: TenantTx, since: Date): Promise<number> {
	const [row] = await tx
		.select({ n: count() })
		.from(auditLog)
		.where(and(eq(auditLog.action, 'unlock.pepper_released'), gt(auditLog.createdAt, since)));
	return row?.n ?? 0;
}

/**
 * Releases the unlock pepper to a bound web session. Limits are always on
 * (independent of the general rate limiter): 10 per hour, 30 per day.
 */
export async function releasePepper(deps: Deps, principal: SessionPrincipal, ipHash: Buffer) {
	return withTenantTx(deps.db.app, principal.storageAccountId, async (tx) => {
		const row = await lockUnlockRow(tx, principal.storageAccountId);
		if (!row?.kdfSalt || !row.pepperCiphertext || !row.pepperKeyId)
			throw new AppError('unlock_not_ready');
		const now = deps.now();
		const lastHour = await releasesSince(tx, addSeconds(now, -3600));
		const lastDay = await releasesSince(tx, addSeconds(now, -86_400));
		if (lastHour >= Limits.pepperReleasesPerHour || lastDay >= Limits.pepperReleasesPerDay) {
			const retryAfter = lastDay >= Limits.pepperReleasesPerDay ? 3600 : 600;
			throw new AppError('unlock_rate_limited', undefined, {
				headers: { 'Retry-After': String(retryAfter) },
			});
		}
		const pepper = deps.pepper.open(principal.storageAccountId, {
			ciphertext: row.pepperCiphertext,
			keyId: row.pepperKeyId,
		});
		const password = [...(await loadMembers(tx)).values()].find(
			(member) => member.kind === 'password' && isActiveMember(member),
		);
		if (password) await grantUnlock(tx, principal, password.id, now);
		await appendAudit(tx, {
			storageAccountId: principal.storageAccountId,
			actor: principalLabel(principal),
			action: 'unlock.pepper_released',
			target: principal.sessionId,
			ipHash,
		});
		return {
			pepper: toBase64Url(pepper),
			remaining_this_hour: Limits.pepperReleasesPerHour - lastHour - 1,
		};
	});
}

/** A wrong master password, reported by the browser; 5 in a row notify other devices. */
export async function recordUnlockFailure(deps: Deps, principal: SessionPrincipal) {
	return withTenantTx(deps.db.app, principal.storageAccountId, async (tx) => {
		const row = await lockUnlockRow(tx, principal.storageAccountId);
		if (!row) throw new AppError('unlock_not_ready');
		const streak = row.failedStreak + 1;
		await tx
			.update(accountUnlock)
			.set({ failedStreak: streak, updatedAt: deps.now() })
			.where(eq(accountUnlock.storageAccountId, principal.storageAccountId));
		if (streak === Limits.unlockFailedStreakAlert) {
			await tx.insert(securityEvents).values({
				storageAccountId: principal.storageAccountId,
				kind: 'unlock.failed_streak',
				severity: 'warning',
				details: { streak, session: principal.sessionId },
			});
			await notifyAccount(tx, principal.storageAccountId, 'unlock.failed_streak', { streak });
		}
		return { failed_streak: streak };
	});
}

/** Key envelopes of one secret-derived member, for a browser that is unlocking. */
export async function envelopesForUnlock(
	deps: Deps,
	principal: SessionPrincipal,
	memberId: string,
) {
	return withTenantTx(deps.db.app, principal.storageAccountId, async (tx) => {
		const member = (await loadMembers(tx)).get(memberId);
		if (!isActiveMember(member) || !SECRET_MEMBER_KINDS.includes(member.kind)) {
			throw new AppError('not_found');
		}
		if (member.kind !== 'recovery') {
			const [grant] = await tx
				.select()
				.from(unlockGrants)
				.where(
					and(
						eq(unlockGrants.sessionId, principal.sessionId),
						eq(unlockGrants.memberId, member.id),
						gt(unlockGrants.expiresAt, deps.now()),
					),
				);
			if (!grant) throw new AppError('unlock_grant_required', { member_kind: member.kind });
		}
		const rows = await tx
			.select()
			.from(keyEnvelopes)
			.where(eq(keyEnvelopes.memberId, member.id))
			.orderBy(asc(keyEnvelopes.pouchId), asc(keyEnvelopes.keyGen));
		await appendAudit(tx, {
			storageAccountId: principal.storageAccountId,
			actor: principalLabel(principal),
			action: 'unlock.envelopes_released',
			target: member.id,
			details: { member_kind: member.kind },
		});
		return { key_envelopes: rows.map(keyEnvelopeView) };
	});
}

/**
 * A browser that just unlocked enrolls itself (15 §7.3B). Statement #1 must
 * `add` *this* browser (its key is the session's DPoP key) and be signed by
 * an active secret-derived member — producing that signature requires the
 * master password, a passkey or the Recovery Key. Follow-ups (e.g. replacing
 * the Recovery Key after using it, removing an expired browser + rotating
 * keys) may be signed by the unlocking member or by the new browser.
 */
export async function enrollBrowser(
	deps: Deps,
	principal: SessionPrincipal,
	input: { statements: RosterStatementInput[]; key_envelopes: KeyEnvelopeInput[] },
	ipHash: Buffer,
) {
	if (!principal.jkt) throw new AppError('session_unbound');
	if (principal.memberId || principal.trustExpiredMemberId) {
		throw new AppError('validation_failed', { reason: 'this browser is already a member' });
	}
	const first = parseRosterStatement(input.statements[0]!.statement).body;
	if (first.action !== 'add' || first.member?.kind !== 'browser') {
		throw new AppError('roster_invalid', { reason: 'first statement must add this browser' });
	}
	if ((await jwkThumbprint(first.member.sign_pub)) !== principal.jkt) {
		throw new AppError('roster_invalid', {
			reason: 'the added browser key must be this session key',
		});
	}
	const newMemberId = first.member.id;
	const unlockingMemberId = first.signer_member_id;

	return withTenantTx(deps.db.app, principal.storageAccountId, async (tx) => {
		const unlocking = (await loadMembers(tx)).get(unlockingMemberId);
		if (!isActiveMember(unlocking) || !SECRET_MEMBER_KINDS.includes(unlocking.kind)) {
			throw new AppError('member_inactive', {
				reason: 'a new browser is added by the master password, a passkey or the Recovery Key',
			});
		}
		const result = await appendStatements(tx, input.statements, {
			storageAccountId: principal.storageAccountId,
			allowedActions: ROSTER_FOLLOW_UPS,
			isSignerAllowed: (signer, index) =>
				index === 0
					? signer === unlockingMemberId
					: signer === unlockingMemberId || signer === newMemberId,
		});
		await insertKeyEnvelopes(tx, principal.storageAccountId, input.key_envelopes);
		await assertEnvelopeCoverage(tx);
		const now = deps.now();
		await tx
			.update(accountMembers)
			.set({ lastSeenAt: now })
			.where(eq(accountMembers.id, newMemberId));
		await tx
			.update(accountUnlock)
			.set({ failedStreak: 0, updatedAt: now })
			.where(eq(accountUnlock.storageAccountId, principal.storageAccountId));
		await tx.insert(securityEvents).values({
			storageAccountId: principal.storageAccountId,
			kind: 'browser.trusted',
			severity: 'info',
			details: { member_id: newMemberId, unlocked_with: unlocking.kind },
		});
		await notifyAccount(tx, principal.storageAccountId, 'browser.trusted', {
			member_id: newMemberId,
			unlocked_with: unlocking.kind,
		});
		await appendAudit(tx, {
			storageAccountId: principal.storageAccountId,
			actor: principalLabel(principal),
			action: 'browser.enrolled',
			target: newMemberId,
			details: { unlocked_with: unlocking.kind, head_seq: result.headSeq },
			ipHash,
		});
		return { member_id: newMemberId, head_seq: result.headSeq };
	});
}

/**
 * Renews trust for a browser whose window lapsed: the browser re-proves a
 * secret by signing `context ‖ member_id ‖ session_jkt` with the derived key
 * of an active password/passkey/recovery member.
 */
export async function renewBrowserTrust(
	deps: Deps,
	principal: SessionPrincipal,
	proof: { signer_member_id: string; signature: string },
) {
	const memberId = principal.trustExpiredMemberId;
	if (!memberId || !principal.jkt)
		throw new AppError('validation_failed', { reason: 'trust is not expired' });
	return withTenantTx(deps.db.app, principal.storageAccountId, async (tx) => {
		const signer = (await loadMembers(tx)).get(proof.signer_member_id);
		if (!isActiveMember(signer) || !SECRET_MEMBER_KINDS.includes(signer.kind)) {
			throw new AppError('member_inactive');
		}
		const message = concatBytes(memberId, '|', principal.jkt!);
		if (!verifyMemberSignature(signer.signPub, proof.signature, RENEW_TRUST_CONTEXT, message)) {
			throw new AppError('signature_invalid');
		}
		await tx
			.update(accountMembers)
			.set({ trustExpiredAt: null, lastSeenAt: deps.now() })
			.where(and(eq(accountMembers.id, memberId), isNull(accountMembers.removedSeq)));
		await appendAudit(tx, {
			storageAccountId: principal.storageAccountId,
			actor: principalLabel(principal),
			action: 'browser.trust_renewed',
			target: memberId,
			details: { unlocked_with: signer.kind },
		});
		return { member_id: memberId };
	});
}

/**
 * Master-password change (15 §8.6): the unlocked browser derives the new
 * `password` member from the *prepared* salt + pepper and submits
 * `add(new)` + `remove(old)` (+ `rotate_keys`). Old password stops working
 * in the same transaction.
 */
export async function changeMasterPassword(
	deps: Deps,
	principal: SessionPrincipal,
	signer: string,
	input: { statements: RosterStatementInput[]; key_envelopes: KeyEnvelopeInput[] },
) {
	const bodies = input.statements.map(
		(statement) => parseRosterStatement(statement.statement).body,
	);
	const added = bodies.find((body) => body.action === 'add' && body.member?.kind === 'password');
	if (!added) throw new AppError('roster_invalid', { reason: 'add the new password member' });
	return withTenantTx(deps.db.app, principal.storageAccountId, async (tx) => {
		const oldPassword = [...(await loadMembers(tx)).values()].find(
			(member) => member.kind === 'password' && isActiveMember(member),
		);
		if (
			!bodies.some((body) => body.action === 'remove' && body.member_id === oldPassword?.id)
		) {
			throw new AppError('roster_invalid', { reason: 'remove the old password member' });
		}
		await commitPendingUnlock(tx, principal.storageAccountId, deps.now());
		const result = await appendStatements(tx, input.statements, {
			storageAccountId: principal.storageAccountId,
			requiredSigner: signer,
			allowedActions: ROSTER_FOLLOW_UPS,
		});
		await insertKeyEnvelopes(tx, principal.storageAccountId, input.key_envelopes);
		await assertEnvelopeCoverage(tx);
		await tx.delete(unlockGrants).where(eq(unlockGrants.memberId, oldPassword!.id));
		await tx.insert(securityEvents).values({
			storageAccountId: principal.storageAccountId,
			kind: 'unlock.password_changed',
			severity: 'info',
			details: {},
		});
		await appendAudit(tx, {
			storageAccountId: principal.storageAccountId,
			actor: principalLabel(principal),
			action: 'unlock.password_changed',
			details: { head_seq: result.headSeq },
		});
		return { head_seq: result.headSeq };
	});
}

export async function readSecuritySettings(deps: Deps, storageAccountId: string) {
	return withTenantTx(deps.db.app, storageAccountId, async (tx) => {
		const [account] = await tx
			.select({ settings: storageAccounts.securitySettings })
			.from(storageAccounts)
			.where(eq(storageAccounts.id, storageAccountId));
		return settingsView(account?.settings ?? {});
	});
}

export function settingsView(settings: Record<string, unknown>) {
	const autoLock = Number(settings.auto_lock_minutes ?? 30);
	return {
		browser_trust_days: browserTrustDays(settings),
		auto_lock_minutes: Number.isInteger(autoLock) ? autoLock : 30,
	};
}

export async function updateSecuritySettings(
	deps: Deps,
	principal: SessionPrincipal,
	patch: { browser_trust_days?: number | undefined; auto_lock_minutes?: number | undefined },
) {
	return withTenantTx(deps.db.app, principal.storageAccountId, async (tx) => {
		const [account] = await tx
			.select({ settings: storageAccounts.securitySettings })
			.from(storageAccounts)
			.where(eq(storageAccounts.id, principal.storageAccountId))
			.for('update');
		const next = { ...(account?.settings ?? {}) };
		for (const [key, value] of Object.entries(patch))
			if (value !== undefined) next[key] = value;
		await tx
			.update(storageAccounts)
			.set({ securitySettings: next, updatedAt: deps.now() })
			.where(eq(storageAccounts.id, principal.storageAccountId));
		await appendAudit(tx, {
			storageAccountId: principal.storageAccountId,
			actor: principalLabel(principal),
			action: 'security.settings_changed',
			details: patch,
		});
		return settingsView(next);
	});
}
