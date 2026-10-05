// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The account roster (plan 15 §7): an append-only, signed hash chain of
 * membership and pouch statements. This service performs the *structural*
 * checks (contiguous seq, prev_hash link, canonical JSON, signer is an active
 * member and really signed it) and applies each statement's effect on the
 * relational tables. Trust decisions stay on the clients.
 */
import {
	Limits,
	fromBase64Url,
	toBase64Url,
	type KeyEnvelopeInput,
	type RosterMember,
	type RosterStatementInput,
} from '@skillpouch/contracts';
import {
	accountMembers,
	keyEnvelopes,
	pouches,
	rosterStatements,
	storageAccounts,
} from '@skillpouch/db';
import { and, asc, eq, gt, inArray, ne } from 'drizzle-orm';
import { AppError } from '../../http/app-error';
import { notifyAccount } from '../../infra/notify';
import { jwkThumbprint } from '../../security/dpop';
import {
	CONTEXT,
	parseRosterStatement,
	verifyMemberSignature,
	type ParsedStatement,
} from '../../security/e2ee-structure';
import type { TenantTx } from '../../security/tenant-tx';

export interface AppendContext {
	storageAccountId: string;
	/** When set, every statement must be signed by this member (the caller). */
	requiredSigner?: string | null;
	/** Device row to attach to a `device` member added by this append (CLI authorize). */
	deviceIdForNewMember?: string;
	/** Which actions this call may contain. */
	allowedActions: ReadonlySet<string>;
	/** Called for `create_pouch` before the pouch is inserted (entitlement check). */
	beforeCreatePouch?: (tx: TenantTx) => Promise<void>;
}

export interface AppendResult {
	statements: ParsedStatement[];
	headSeq: number;
	createdPouchIds: string[];
	addedMemberIds: string[];
	removedMemberIds: string[];
}

type MemberRow = typeof accountMembers.$inferSelect;

export async function loadMembers(tx: TenantTx): Promise<Map<string, MemberRow>> {
	const rows = await tx.select().from(accountMembers);
	return new Map(rows.map((row) => [row.id, row]));
}

export function isActiveMember(member: MemberRow | undefined): member is MemberRow {
	return member !== undefined && member.removedSeq === null && member.revokedAt === null;
}

async function lockAccount(tx: TenantTx, storageAccountId: string) {
	const [account] = await tx
		.select()
		.from(storageAccounts)
		.where(eq(storageAccounts.id, storageAccountId))
		.for('update');
	if (!account) throw new AppError('not_found');
	return account;
}

async function insertMember(
	tx: TenantTx,
	storageAccountId: string,
	member: RosterMember,
	seq: number,
	deviceId: string | null,
): Promise<void> {
	await tx.insert(accountMembers).values({
		id: member.id,
		storageAccountId,
		kind: member.kind,
		deviceId,
		sessionJkt: member.kind === 'browser' ? await jwkThumbprint(member.sign_pub) : null,
		signPub: { ...member.sign_pub },
		encPub: { ...member.enc_pub },
		labelEnc: member.label_enc ? Buffer.from(fromBase64Url(member.label_enc)) : null,
		keyStorage: member.key_storage ?? null,
		addedSeq: seq,
	});
}

/**
 * Appends statements in order inside the caller's transaction and applies
 * their effects. Throws `roster_conflict` when the client built on a stale
 * head — it should fetch the roster and retry.
 */
export async function appendStatements(
	tx: TenantTx,
	inputs: RosterStatementInput[],
	ctx: AppendContext,
): Promise<AppendResult> {
	const account = await lockAccount(tx, ctx.storageAccountId);
	const members = await loadMembers(tx);
	let seq = account.genesisHash === null ? -1 : account.rosterSeq;
	let headHash: Buffer | null = account.rosterHeadHash;
	const result: AppendResult = {
		statements: [],
		headSeq: seq,
		createdPouchIds: [],
		addedMemberIds: [],
		removedMemberIds: [],
	};

	for (const input of inputs) {
		const parsed = parseRosterStatement(input.statement);
		const body = parsed.body;
		if (parsed.bytes.length > Limits.rosterStatementMaxBytes) throw new AppError('roster_invalid', { reason: 'too large' });
		if (!ctx.allowedActions.has(body.action)) {
			throw new AppError('roster_invalid', { reason: `action ${body.action} not allowed here` });
		}
		if (body.account_id !== ctx.storageAccountId) throw new AppError('roster_invalid', { reason: 'account_id' });
		const expectedPrev = headHash ? toBase64Url(headHash) : null;
		if (body.seq !== seq + 1 || body.prev_hash !== expectedPrev) {
			throw new AppError('roster_conflict', { expected_seq: seq + 1 });
		}
		if (ctx.requiredSigner !== undefined && body.signer_member_id !== ctx.requiredSigner) {
			throw new AppError('member_inactive', { reason: 'statement must be signed by the caller' });
		}

		// Genesis is self-signed by one of the members it introduces.
		const signer =
			body.action === 'genesis'
				? body.members?.find((member) => member.id === body.signer_member_id)
				: members.get(body.signer_member_id);
		if (!signer) throw new AppError('member_inactive');
		if (body.action !== 'genesis' && !isActiveMember(signer as MemberRow)) {
			throw new AppError('member_inactive');
		}
		const signerPub = 'signPub' in signer ? signer.signPub : signer.sign_pub;
		if (!verifyMemberSignature(signerPub, input.signature, CONTEXT.roster, parsed.bytes)) {
			throw new AppError('signature_invalid', { seq: body.seq });
		}

		const statementPouchId = await applyEffect(tx, ctx, body, members, result);

		await tx.insert(rosterStatements).values({
			storageAccountId: ctx.storageAccountId,
			seq: body.seq,
			pouchId: statementPouchId,
			prevHash: headHash,
			statement: parsed.bytes,
			statementHash: parsed.hash,
			signerMemberId: body.signer_member_id,
			signature: Buffer.from(fromBase64Url(input.signature)),
		});
		seq = body.seq;
		headHash = parsed.hash;
		result.statements.push(parsed);
		if (body.action === 'genesis') {
			await tx
				.update(storageAccounts)
				.set({ genesisHash: parsed.hash })
				.where(eq(storageAccounts.id, ctx.storageAccountId));
		}
		// Keep the in-memory member map current for the next statement in this batch.
		for (const row of await tx.select().from(accountMembers)) members.set(row.id, row);
	}

	await tx
		.update(storageAccounts)
		.set({ rosterSeq: seq, rosterHeadHash: headHash, updatedAt: new Date() })
		.where(eq(storageAccounts.id, ctx.storageAccountId));
	result.headSeq = seq;
	await notifyAccount(tx, ctx.storageAccountId, 'roster.changed', { seq });
	return result;
}

async function applyEffect(
	tx: TenantTx,
	ctx: AppendContext,
	body: ParsedStatement['body'],
	members: Map<string, MemberRow>,
	result: AppendResult,
): Promise<string | null> {
	switch (body.action) {
		case 'genesis': {
			const list = body.members ?? [];
			const browsers = list.filter((member) => member.kind === 'browser');
			const recovery = list.filter((member) => member.kind === 'recovery');
			if (browsers.length < 1 || recovery.length !== 1 || browsers.length + recovery.length !== list.length) {
				throw new AppError('roster_invalid', { reason: 'genesis needs ≥1 browser and exactly 1 recovery member' });
			}
			for (const member of list) {
				await insertMember(tx, ctx.storageAccountId, member, body.seq, null);
				result.addedMemberIds.push(member.id);
			}
			return null;
		}
		case 'add': {
			const member = body.member;
			if (!member || members.has(member.id)) throw new AppError('roster_invalid', { reason: 'member' });
			if (member.kind === 'device' && !ctx.deviceIdForNewMember) {
				throw new AppError('roster_invalid', { reason: 'devices join only through CLI authorize' });
			}
			if (member.kind === 'recovery' && [...members.values()].some((m) => m.kind === 'recovery' && isActiveMember(m))) {
				throw new AppError('roster_invalid', { reason: 'remove the old recovery member first' });
			}
			await insertMember(
				tx,
				ctx.storageAccountId,
				member,
				body.seq,
				member.kind === 'device' ? (ctx.deviceIdForNewMember ?? null) : null,
			);
			result.addedMemberIds.push(member.id);
			return null;
		}
		case 'remove': {
			const target = body.member_id ? members.get(body.member_id) : undefined;
			if (!target || target.removedSeq !== null) throw new AppError('roster_invalid', { reason: 'member_id' });
			const remainingHumans = [...members.values()].filter(
				(m) => m.id !== target.id && m.kind !== 'recovery' && m.removedSeq === null,
			);
			if (target.kind !== 'recovery' && remainingHumans.length === 0) {
				throw new AppError('roster_invalid', { reason: 'cannot remove the last non-recovery member' });
			}
			await tx
				.update(accountMembers)
				.set({ removedSeq: body.seq, revokedAt: target.revokedAt ?? new Date() })
				.where(eq(accountMembers.id, target.id));
			result.removedMemberIds.push(target.id);
			return null;
		}
		case 'rotate_keys': {
			const generations = body.new_generations ?? {};
			const live = await tx
				.select({ id: pouches.id, keyGen: pouches.keyGen })
				.from(pouches)
				.where(ne(pouches.state, 'deleted'));
			for (const pouch of live) {
				if (generations[pouch.id] !== pouch.keyGen + 1) {
					throw new AppError('key_gen_invalid', { pouch_id: pouch.id, expected: pouch.keyGen + 1 });
				}
			}
			for (const pouch of live) {
				await tx.update(pouches).set({ keyGen: pouch.keyGen + 1 }).where(eq(pouches.id, pouch.id));
			}
			return null;
		}
		case 'create_pouch': {
			const pouchId = body.pouch?.id;
			if (!pouchId) throw new AppError('roster_invalid', { reason: 'pouch' });
			const [existing] = await tx.select({ id: pouches.id }).from(pouches).where(eq(pouches.id, pouchId));
			if (existing) throw new AppError('roster_invalid', { reason: 'pouch exists' });
			await ctx.beforeCreatePouch?.(tx);
			await tx.insert(pouches).values({
				id: pouchId,
				storageAccountId: ctx.storageAccountId,
				createdSeq: body.seq,
				epoch: crypto.randomUUID(),
			});
			result.createdPouchIds.push(pouchId);
			return pouchId;
		}
		case 'rename_pouch':
		case 'archive_pouch': {
			const pouchId = body.pouch?.id;
			const [pouch] = pouchId
				? await tx.select().from(pouches).where(eq(pouches.id, pouchId))
				: [];
			if (!pouch || pouch.state === 'deleted') throw new AppError('not_found');
			if (body.action === 'archive_pouch') {
				await tx.update(pouches).set({ state: 'archived', updatedAt: new Date() }).where(eq(pouches.id, pouch.id));
				await notifyAccount(tx, ctx.storageAccountId, 'pouch.state_changed', { pouch_id: pouch.id });
			}
			return pouch.id;
		}
	}
}

/**
 * Stores key envelopes. Each must target an existing pouch and member, use a
 * generation the pouch has reached, and be created by an active member.
 */
export async function insertKeyEnvelopes(
	tx: TenantTx,
	storageAccountId: string,
	envelopes: KeyEnvelopeInput[],
): Promise<void> {
	if (envelopes.length === 0) return;
	const members = await loadMembers(tx);
	const pouchIds = [...new Set(envelopes.map((envelope) => envelope.pouch_id))];
	const rows = await tx
		.select({ id: pouches.id, keyGen: pouches.keyGen, state: pouches.state })
		.from(pouches)
		.where(inArray(pouches.id, pouchIds));
	const byId = new Map(rows.map((row) => [row.id, row]));
	for (const envelope of envelopes) {
		const pouch = byId.get(envelope.pouch_id);
		if (!pouch || pouch.state === 'deleted') throw new AppError('not_found', { pouch_id: envelope.pouch_id });
		if (envelope.key_gen > pouch.keyGen) throw new AppError('key_gen_invalid', { pouch_id: pouch.id });
		if (!members.has(envelope.member_id)) throw new AppError('roster_invalid', { reason: 'envelope member' });
		if (!isActiveMember(members.get(envelope.created_by_member))) throw new AppError('member_inactive');
	}
	await tx
		.insert(keyEnvelopes)
		.values(
			envelopes.map((envelope) => ({
				storageAccountId,
				pouchId: envelope.pouch_id,
				memberId: envelope.member_id,
				keyGen: envelope.key_gen,
				hpkeEnc: Buffer.from(fromBase64Url(envelope.hpke_enc)),
				ciphertext: Buffer.from(fromBase64Url(envelope.ciphertext)),
				createdByMember: envelope.created_by_member,
				signature: Buffer.from(fromBase64Url(envelope.signature)),
			})),
		)
		.onConflictDoNothing();
}

/**
 * After membership or generation changes, every active member must hold an
 * envelope for the current generation of every live pouch — otherwise some
 * member would silently lose access.
 */
export async function assertEnvelopeCoverage(tx: TenantTx, pouchIds?: string[]): Promise<void> {
	const members = [...(await loadMembers(tx)).values()].filter(isActiveMember);
	const live = await tx
		.select({ id: pouches.id, keyGen: pouches.keyGen })
		.from(pouches)
		.where(pouchIds ? and(ne(pouches.state, 'deleted'), inArray(pouches.id, pouchIds)) : ne(pouches.state, 'deleted'));
	for (const pouch of live) {
		const present = await tx
			.select({ memberId: keyEnvelopes.memberId })
			.from(keyEnvelopes)
			.where(and(eq(keyEnvelopes.pouchId, pouch.id), eq(keyEnvelopes.keyGen, pouch.keyGen)));
		const have = new Set(present.map((row) => row.memberId));
		const missing = members.filter((member) => !have.has(member.id)).map((member) => member.id);
		if (missing.length > 0) {
			throw new AppError('roster_invalid', {
				reason: 'missing key envelopes',
				pouch_id: pouch.id,
				key_gen: pouch.keyGen,
				member_ids: missing,
			});
		}
	}
}

export async function readRoster(tx: TenantTx, afterSeq: number) {
	return tx
		.select()
		.from(rosterStatements)
		.where(gt(rosterStatements.seq, afterSeq))
		.orderBy(asc(rosterStatements.seq))
		.limit(500);
}

export function rosterStatementView(row: typeof rosterStatements.$inferSelect) {
	return {
		seq: row.seq,
		prev_hash: row.prevHash ? toBase64Url(row.prevHash) : null,
		statement: toBase64Url(row.statement),
		statement_hash: toBase64Url(row.statementHash),
		signer_member_id: row.signerMemberId,
		signature: toBase64Url(row.signature),
		pouch_id: row.pouchId,
		created_at: row.createdAt.toISOString(),
	};
}

export function memberView(row: MemberRow) {
	return {
		id: row.id,
		kind: row.kind,
		device_id: row.deviceId,
		sign_pub: row.signPub as { kty: 'EC'; crv: 'P-256'; x: string; y: string },
		enc_pub: row.encPub as { kty: 'EC'; crv: 'P-256'; x: string; y: string },
		label_enc: row.labelEnc ? toBase64Url(row.labelEnc) : null,
		added_seq: row.addedSeq,
		removed_seq: row.removedSeq,
		revoked_at: row.revokedAt?.toISOString() ?? null,
		last_seen_at: row.lastSeenAt?.toISOString() ?? null,
	};
}

