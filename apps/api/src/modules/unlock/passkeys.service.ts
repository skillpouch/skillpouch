// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Passkeys as *unlock keys* — not for sign-in.
 *
 * A passkey's WebAuthn PRF output derives a `passkey` member in the browser.
 * The server stores the credential id + public key so it can (1) offer the
 * credential in `allowCredentials` and (2) verify an assertion before it
 * releases that member's key envelopes to a browser that is unlocking. The
 * PRF output itself never leaves the browser.
 */
import { randomUUID } from 'node:crypto';
import {
	Limits,
	fromBase64Url,
	toBase64Url,
	type KeyEnvelopeInput,
	type RosterStatementInput,
} from '@skillpouch/contracts';
import { passkeyUnlockers, securityEvents, unlockGrants, webauthnChallenges } from '@skillpouch/db';
import {
	generateAuthenticationOptions,
	generateRegistrationOptions,
	verifyAuthenticationResponse,
	verifyRegistrationResponse,
	type AuthenticationResponseJSON,
	type AuthenticatorTransport,
	type RegistrationResponseJSON,
} from '@simplewebauthn/server';
import { and, eq, gt } from 'drizzle-orm';
import type { Deps } from '../../deps';
import { AppError } from '../../http/app-error';
import { notifyAccount } from '../../infra/notify';
import { addSeconds } from '../../lib/dates';
import { appendAudit } from '../../security/audit';
import { parseRosterStatement } from '../../security/e2ee-structure';
import { principalLabel, type SessionPrincipal } from '../../security/principal';
import { withTenantTx, type TenantTx } from '../../security/tenant-tx';
import {
	appendStatements,
	assertEnvelopeCoverage,
	insertKeyEnvelopes,
	isActiveMember,
	loadMembers,
} from '../roster/roster.service';
import { grantUnlock, passkeyView } from './unlock.service';

type Purpose = 'register' | 'unlock';

async function storeChallenge(
	deps: Deps,
	tx: TenantTx,
	principal: SessionPrincipal,
	purpose: Purpose,
	challenge: string,
) {
	await tx
		.delete(webauthnChallenges)
		.where(
			and(
				eq(webauthnChallenges.sessionId, principal.sessionId),
				eq(webauthnChallenges.purpose, purpose),
			),
		);
	await tx.insert(webauthnChallenges).values({
		id: randomUUID(),
		storageAccountId: principal.storageAccountId,
		sessionId: principal.sessionId,
		purpose,
		challenge,
		expiresAt: addSeconds(deps.now(), Limits.webauthnChallengeSeconds),
	});
}

/** Takes (and deletes) this session's live challenge — each one verifies at most once. */
async function consumeChallenge(
	deps: Deps,
	tx: TenantTx,
	principal: SessionPrincipal,
	purpose: Purpose,
) {
	const [row] = await tx
		.delete(webauthnChallenges)
		.where(
			and(
				eq(webauthnChallenges.sessionId, principal.sessionId),
				eq(webauthnChallenges.purpose, purpose),
				gt(webauthnChallenges.expiresAt, deps.now()),
			),
		)
		.returning();
	if (!row) throw new AppError('webauthn_invalid', { reason: 'no live challenge' });
	return row.challenge;
}

/**
 * The PRF output is the unlock secret. Browsers put it in
 * `clientExtensionResults`; SkillPouch's client strips it, and a response
 * that still carries it is refused rather than silently accepted.
 */
function refuseLeakedPrf(response: Record<string, unknown>): void {
	const extensions = response.clientExtensionResults as { prf?: { results?: unknown } } | null;
	if (extensions?.prf?.results !== undefined) {
		throw new AppError('webauthn_invalid', {
			reason: 'the PRF output must stay in the browser',
		});
	}
}

function rp(deps: Deps) {
	return {
		rpID: deps.env.WEBAUTHN_RP_ID,
		rpName: deps.env.WEBAUTHN_RP_NAME,
		origin: deps.env.WEB_ORIGIN,
	};
}

export async function registrationOptions(deps: Deps, principal: SessionPrincipal) {
	return withTenantTx(deps.db.app, principal.storageAccountId, async (tx) => {
		const existing = await tx.select().from(passkeyUnlockers);
		const options = await generateRegistrationOptions({
			rpName: rp(deps).rpName,
			rpID: rp(deps).rpID,
			userName: principal.email,
			userID: new TextEncoder().encode(principal.storageAccountId),
			attestationType: 'none',
			excludeCredentials: existing.map((row) => ({ id: toBase64Url(row.credentialId) })),
			authenticatorSelection: { residentKey: 'preferred', userVerification: 'required' },
		});
		await storeChallenge(deps, tx, principal, 'register', options.challenge);
		// The browser adds `extensions.prf.eval` itself (the salt is per member).
		return { options: { ...options, extensions: { ...options.extensions, prf: {} } } };
	});
}

export async function registerPasskey(
	deps: Deps,
	principal: SessionPrincipal,
	signer: string,
	input: {
		response: Record<string, unknown>;
		label?: string | undefined;
		statement: RosterStatementInput;
		key_envelopes: KeyEnvelopeInput[];
	},
) {
	const body = parseRosterStatement(input.statement.statement).body;
	if (body.action !== 'add' || body.member?.kind !== 'passkey') {
		throw new AppError('roster_invalid', { reason: 'expected add(passkey member)' });
	}
	const memberId = body.member.id;
	refuseLeakedPrf(input.response);
	return withTenantTx(deps.db.app, principal.storageAccountId, async (tx) => {
		const expectedChallenge = await consumeChallenge(deps, tx, principal, 'register');
		let verification;
		try {
			verification = await verifyRegistrationResponse({
				response: input.response as unknown as RegistrationResponseJSON,
				expectedChallenge,
				expectedOrigin: rp(deps).origin,
				expectedRPID: rp(deps).rpID,
				requireUserVerification: true,
			});
		} catch (error) {
			throw new AppError('webauthn_invalid', { reason: (error as Error).message });
		}
		if (!verification.verified) throw new AppError('webauthn_invalid');
		const credential = verification.registrationInfo.credential;

		await appendStatements(tx, [input.statement], {
			storageAccountId: principal.storageAccountId,
			requiredSigner: signer,
			allowedActions: new Set(['add']),
			allowPasskeyAdd: true,
		});
		await insertKeyEnvelopes(tx, principal.storageAccountId, input.key_envelopes);
		await assertEnvelopeCoverage(tx);
		const [row] = await tx
			.insert(passkeyUnlockers)
			.values({
				id: randomUUID(),
				storageAccountId: principal.storageAccountId,
				memberId,
				credentialId: Buffer.from(fromBase64Url(credential.id)),
				publicKey: Buffer.from(credential.publicKey),
				signCount: credential.counter,
				transports: credential.transports ?? [],
				label: input.label ?? null,
			})
			.returning();
		await tx.insert(securityEvents).values({
			storageAccountId: principal.storageAccountId,
			kind: 'passkey.added',
			severity: 'info',
			details: { member_id: memberId, label: row!.label },
		});
		await notifyAccount(tx, principal.storageAccountId, 'passkey.added', {
			member_id: memberId,
		});
		await appendAudit(tx, {
			storageAccountId: principal.storageAccountId,
			actor: principalLabel(principal),
			action: 'passkey.added',
			target: memberId,
		});
		return passkeyView(row!);
	});
}

export async function renamePasskey(
	deps: Deps,
	principal: SessionPrincipal,
	passkeyId: string,
	label: string,
) {
	return withTenantTx(deps.db.app, principal.storageAccountId, async (tx) => {
		const [row] = await tx
			.update(passkeyUnlockers)
			.set({ label })
			.where(eq(passkeyUnlockers.id, passkeyId))
			.returning();
		if (!row) throw new AppError('not_found');
		await appendAudit(tx, {
			storageAccountId: principal.storageAccountId,
			actor: principalLabel(principal),
			action: 'passkey.renamed',
			target: row.memberId,
		});
		return passkeyView(row);
	});
}

export async function removePasskey(
	deps: Deps,
	principal: SessionPrincipal,
	signer: string,
	passkeyId: string,
	input: { statements: RosterStatementInput[]; key_envelopes: KeyEnvelopeInput[] },
) {
	return withTenantTx(deps.db.app, principal.storageAccountId, async (tx) => {
		const [passkey] = await tx
			.select()
			.from(passkeyUnlockers)
			.where(eq(passkeyUnlockers.id, passkeyId));
		if (!passkey) throw new AppError('not_found');
		const actions = input.statements.map(
			(statement) => parseRosterStatement(statement.statement).body,
		);
		if (
			!actions.some((body) => body.action === 'remove' && body.member_id === passkey.memberId)
		) {
			throw new AppError('roster_invalid', { reason: 'remove the passkey member' });
		}
		if (!actions.some((body) => body.action === 'rotate_keys')) {
			// It may have been a lost security key: rotate.
			throw new AppError('roster_invalid', { reason: 'removing a passkey rotates keys' });
		}
		const result = await appendStatements(tx, input.statements, {
			storageAccountId: principal.storageAccountId,
			requiredSigner: signer,
			allowedActions: new Set(['remove', 'rotate_keys']),
		});
		await insertKeyEnvelopes(tx, principal.storageAccountId, input.key_envelopes);
		await assertEnvelopeCoverage(tx);
		await tx.delete(passkeyUnlockers).where(eq(passkeyUnlockers.id, passkey.id));
		await tx.delete(unlockGrants).where(eq(unlockGrants.memberId, passkey.memberId));
		await tx.insert(securityEvents).values({
			storageAccountId: principal.storageAccountId,
			kind: 'passkey.removed',
			severity: 'info',
			details: { member_id: passkey.memberId, label: passkey.label },
		});
		await notifyAccount(tx, principal.storageAccountId, 'passkey.removed', {
			member_id: passkey.memberId,
		});
		await appendAudit(tx, {
			storageAccountId: principal.storageAccountId,
			actor: principalLabel(principal),
			action: 'passkey.removed',
			target: passkey.memberId,
		});
		return { head_seq: result.headSeq };
	});
}

export async function assertionOptions(deps: Deps, principal: SessionPrincipal) {
	return withTenantTx(deps.db.app, principal.storageAccountId, async (tx) => {
		const members = await loadMembers(tx);
		const rows = (await tx.select().from(passkeyUnlockers)).filter((row) =>
			isActiveMember(members.get(row.memberId)),
		);
		if (rows.length === 0) throw new AppError('not_found', { reason: 'no passkey unlockers' });
		const options = await generateAuthenticationOptions({
			rpID: rp(deps).rpID,
			userVerification: 'required',
			allowCredentials: rows.map((row) => ({
				id: toBase64Url(row.credentialId),
				transports: (row.transports ?? []) as AuthenticatorTransport[],
			})),
		});
		await storeChallenge(deps, tx, principal, 'unlock', options.challenge);
		return { options: { ...options } as Record<string, unknown> };
	});
}

/** Verifies a PRF unlock assertion and grants this session that member's envelopes. */
export async function verifyAssertion(
	deps: Deps,
	principal: SessionPrincipal,
	response: Record<string, unknown>,
) {
	refuseLeakedPrf(response);
	return withTenantTx(deps.db.app, principal.storageAccountId, async (tx) => {
		const expectedChallenge = await consumeChallenge(deps, tx, principal, 'unlock');
		const credentialId = String(response.id ?? '');
		const [passkey] = await tx
			.select()
			.from(passkeyUnlockers)
			.where(eq(passkeyUnlockers.credentialId, Buffer.from(fromBase64Url(credentialId))));
		if (!passkey || !isActiveMember((await loadMembers(tx)).get(passkey.memberId))) {
			throw new AppError('webauthn_invalid', { reason: 'unknown credential' });
		}
		let verification;
		try {
			verification = await verifyAuthenticationResponse({
				response: response as unknown as AuthenticationResponseJSON,
				expectedChallenge,
				expectedOrigin: rp(deps).origin,
				expectedRPID: rp(deps).rpID,
				requireUserVerification: true,
				credential: {
					id: credentialId,
					publicKey: new Uint8Array(passkey.publicKey),
					counter: passkey.signCount,
					transports: (passkey.transports ?? []) as AuthenticatorTransport[],
				},
			});
		} catch (error) {
			throw new AppError('webauthn_invalid', { reason: (error as Error).message });
		}
		if (!verification.verified) throw new AppError('webauthn_invalid');
		const now = deps.now();
		await tx
			.update(passkeyUnlockers)
			.set({ signCount: verification.authenticationInfo.newCounter, lastUsedAt: now })
			.where(eq(passkeyUnlockers.id, passkey.id));
		const expiresAt = await grantUnlock(tx, principal, passkey.memberId, now);
		await appendAudit(tx, {
			storageAccountId: principal.storageAccountId,
			actor: principalLabel(principal),
			action: 'passkey.asserted',
			target: passkey.memberId,
		});
		return { member_id: passkey.memberId, expires_at: expiresAt.toISOString() };
	});
}
