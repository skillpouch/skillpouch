// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The account roster: an append-only, signed hash chain of membership and
 * pouch statements. The server stores it but cannot forge, reorder or edit
 * it; every client replays it from the pinned genesis hash and derives who
 * may sign and which pouches exist.
 *
 *   statement_hash = BLAKE3(canonical JSON bytes)
 *   signature      = sign(signer, "skillpouch/v1/roster", canonical JSON bytes)
 */
import { blake3 } from '@noble/hashes/blake3.js';
import {
	canonicalJson,
	type RosterMember,
	type RosterStatementBody,
	type RosterStatementInput,
} from '@skillpouch/contracts';
import { b64, fromUtf8, unb64, utf8 } from './bytes';
import { CryptoError } from './errors';
import { publicJwk, requireSignature, sign, type MemberKeyPair, type PublicJwk } from './keys';

export const ROSTER_CONTEXT = 'skillpouch/v1/roster';

/** A statement as the API returns it. */
export interface RosterStatementWire {
	seq: number;
	statement: string;
	statement_hash: string;
	signature: string;
}

export interface MemberState {
	id: string;
	kind: RosterMember['kind'];
	signPub: PublicJwk;
	encPub: PublicJwk;
	memberSalt: string | null;
	labelEnc: string | null;
	keyStorage: string | null;
	addedSeq: number;
	removedSeq: number | null;
}

export interface PouchState {
	id: string;
	/** Sealed `{ name, description }` (see `pouch-meta.ts`). */
	nameEnc: string | null;
	createdSeq: number;
	archived: boolean;
	/** Newest key generation announced by the roster. */
	keyGen: number;
}

export interface RosterState {
	accountId: string;
	genesisHash: string;
	headSeq: number;
	headHash: string;
	members: Map<string, MemberState>;
	pouches: Map<string, PouchState>;
	/** The seq of every statement, by its hash. */
	heads: Map<string, number>;
}

export function isActive(member: MemberState): boolean {
	return member.removedSeq === null;
}

export function activeMembers(state: RosterState): MemberState[] {
	return [...state.members.values()].filter(isActive);
}

export function memberOrThrow(state: RosterState, id: string): MemberState {
	const member = state.members.get(id);
	if (!member) throw new CryptoError('signature_invalid', `unknown member ${id}`);
	return member;
}

/** Was `memberId` allowed to sign at roster position `seq` (i.e. active after `seq - 1`)? */
export function activeAt(state: RosterState, memberId: string, seq: number): boolean {
	const member = state.members.get(memberId);
	if (!member) return false;
	return member.addedSeq < seq && (member.removedSeq === null || member.removedSeq >= seq);
}

/**
 * Whether `memberId` may have signed a revision that names `rosterHead` (the
 * roster its author saw). A removed member's signature only counts on
 * revisions written before it was removed; a head newer than this roster
 * only from a current member.
 */
export function maySignRevision(state: RosterState, memberId: string, rosterHead: string): boolean {
	const member = state.members.get(memberId);
	if (!member) return false;
	const seq = state.heads.get(rosterHead);
	if (seq === undefined) return member.removedSeq === null;
	return member.addedSeq <= seq && (member.removedSeq === null || seq < member.removedSeq);
}

// ---- writing -------------------------------------------------------------------------

export type StatementFields = Omit<
	RosterStatementBody,
	'format' | 'account_id' | 'seq' | 'prev_hash' | 'created_at' | 'signer_member_id'
>;

export interface RosterHead {
	seq: number;
	hash: string | null;
}

export interface SignedStatement {
	input: RosterStatementInput;
	body: RosterStatementBody;
	hash: string;
}

/** Builds and signs the next statement on top of `head`, then advances `head`. */
export async function signStatement(
	signer: { id: string; signKey: CryptoKey },
	accountId: string,
	head: RosterHead,
	fields: StatementFields,
	createdAt = new Date().toISOString(),
): Promise<SignedStatement> {
	const body: RosterStatementBody = {
		format: 1,
		account_id: accountId,
		seq: head.seq + 1,
		prev_hash: head.hash,
		created_at: createdAt,
		signer_member_id: signer.id,
		...fields,
	};
	const bytes = utf8(canonicalJson(body));
	const hash = b64(blake3(bytes));
	head.seq = body.seq;
	head.hash = hash;
	return {
		input: {
			statement: b64(bytes),
			signature: await sign(signer.signKey, ROSTER_CONTEXT, bytes),
		},
		body,
		hash,
	};
}

/** The roster entry describing a member's public keys. */
export function memberEntry(
	id: string,
	kind: RosterMember['kind'],
	keys: Pick<MemberKeyPair, 'signPub' | 'encPub'>,
	extra: {
		memberSalt?: string;
		labelEnc?: string;
		keyStorage?: RosterMember['key_storage'];
	} = {},
): RosterMember {
	return {
		id,
		kind,
		sign_pub: keys.signPub,
		enc_pub: keys.encPub,
		...(extra.memberSalt ? { member_salt: extra.memberSalt } : {}),
		...(extra.labelEnc ? { label_enc: extra.labelEnc } : {}),
		...(extra.keyStorage ? { key_storage: extra.keyStorage } : {}),
	};
}

// ---- verification ----------------------------------------------------------------------

function parseBody(wire: RosterStatementWire): { bytes: Uint8Array; body: RosterStatementBody } {
	const bytes = unb64(wire.statement);
	let body: RosterStatementBody;
	try {
		body = JSON.parse(fromUtf8(bytes)) as RosterStatementBody;
	} catch {
		throw new CryptoError('format_unsupported', `roster #${wire.seq} is not JSON`);
	}
	if (body.format !== 1 || canonicalJson(body) !== fromUtf8(bytes)) {
		throw new CryptoError('format_unsupported', `roster #${wire.seq} is not canonical`);
	}
	return { bytes, body };
}

function addMember(state: RosterState, member: RosterMember, seq: number): void {
	if (state.members.has(member.id)) {
		throw new CryptoError('roster_fork', `member ${member.id} added twice`);
	}
	state.members.set(member.id, {
		id: member.id,
		kind: member.kind,
		signPub: publicJwk(member.sign_pub),
		encPub: publicJwk(member.enc_pub),
		memberSalt: member.member_salt ?? null,
		labelEnc: member.label_enc ?? null,
		keyStorage: member.key_storage ?? null,
		addedSeq: seq,
		removedSeq: null,
	});
}

function applyStatement(state: RosterState, body: RosterStatementBody): void {
	const seq = body.seq;
	switch (body.action) {
		case 'genesis':
			throw new CryptoError('roster_fork', 'a second genesis statement');
		case 'add':
			if (!body.member) throw new CryptoError('format_unsupported', 'add without member');
			addMember(state, body.member, seq);
			return;
		case 'remove': {
			const member = body.member_id ? state.members.get(body.member_id) : undefined;
			if (!member || !isActive(member)) {
				throw new CryptoError('roster_fork', 'remove of an unknown or removed member');
			}
			member.removedSeq = seq;
			return;
		}
		case 'rotate_keys':
			for (const [pouchId, keyGen] of Object.entries(body.new_generations ?? {})) {
				const pouch = state.pouches.get(pouchId);
				if (pouch && keyGen > pouch.keyGen) pouch.keyGen = keyGen;
			}
			return;
		case 'create_pouch': {
			if (!body.pouch || state.pouches.has(body.pouch.id)) {
				throw new CryptoError('roster_fork', 'pouch created twice');
			}
			state.pouches.set(body.pouch.id, {
				id: body.pouch.id,
				nameEnc: body.pouch.name_enc ?? null,
				createdSeq: seq,
				archived: false,
				keyGen: 1,
			});
			return;
		}
		case 'rename_pouch':
		case 'archive_pouch': {
			const pouch = body.pouch ? state.pouches.get(body.pouch.id) : undefined;
			if (!pouch) throw new CryptoError('roster_fork', 'statement for an unknown pouch');
			if (body.action === 'rename_pouch')
				pouch.nameEnc = body.pouch?.name_enc ?? pouch.nameEnc;
			else pouch.archived = true;
			return;
		}
	}
}

function countActive(state: RosterState, kind: MemberState['kind']): number {
	return activeMembers(state).filter((member) => member.kind === kind).length;
}

/**
 * Replays roster statements and returns the resulting state.
 *
 * - `previous` continues from an already verified state (incremental sync).
 * - `pinnedGenesisHash` must match statement #0 when replaying from scratch.
 * - `reportedHeadSeq` is the server's claimed head; below what we already
 *   verified means the server rolled the roster back.
 *
 * Throws `roster_fork` / `roster_rollback` / `signature_invalid` on anything
 * a client must refuse to trust.
 */
export async function verifyRoster(
	statements: RosterStatementWire[],
	options: {
		accountId: string;
		pinnedGenesisHash?: string | null;
		previous?: RosterState;
		reportedHeadSeq?: number;
		/**
		 * Skip the one-password/one-recovery check. Only for a statement built
		 * locally in the middle of a replacement (add new → remove old), whose
		 * finished batch is checked normally.
		 */
		partial?: boolean;
	},
): Promise<RosterState> {
	const previous = options.previous;
	if (
		previous &&
		options.reportedHeadSeq !== undefined &&
		options.reportedHeadSeq < previous.headSeq
	) {
		throw new CryptoError('roster_rollback', 'the roster went backwards');
	}
	let state = previous ? cloneState(previous) : undefined;
	const sorted = [...statements].sort((a, b) => a.seq - b.seq);

	for (const wire of sorted) {
		if (state && wire.seq <= state.headSeq) {
			if (wire.seq === state.headSeq && wire.statement_hash !== state.headHash) {
				throw new CryptoError(
					'roster_fork',
					`roster #${wire.seq} changed after it was seen`,
				);
			}
			continue;
		}
		const { bytes, body } = parseBody(wire);
		const hash = b64(blake3(bytes));
		if (hash !== wire.statement_hash || body.seq !== wire.seq) {
			throw new CryptoError('roster_fork', `roster #${wire.seq} hash mismatch`);
		}
		if (body.account_id !== options.accountId) {
			throw new CryptoError('roster_fork', 'statement of another account');
		}

		if (!state) {
			if (body.seq !== 0 || body.action !== 'genesis' || body.prev_hash !== null) {
				throw new CryptoError('roster_fork', 'roster does not start with genesis');
			}
			if (options.pinnedGenesisHash && options.pinnedGenesisHash !== hash) {
				throw new CryptoError('roster_fork', 'genesis differs from the pinned one');
			}
			state = {
				accountId: body.account_id,
				genesisHash: hash,
				headSeq: -1,
				headHash: '',
				members: new Map(),
				pouches: new Map(),
				heads: new Map(),
			};
			for (const member of body.members ?? []) addMember(state, member, 0);
			const signer = state.members.get(body.signer_member_id);
			if (!signer)
				throw new CryptoError('signature_invalid', 'genesis signer is not a member');
			await requireSignature(
				signer.signPub,
				wire.signature,
				ROSTER_CONTEXT,
				bytes,
				'genesis',
			);
		} else {
			if (body.seq !== state.headSeq + 1 || body.prev_hash !== state.headHash) {
				throw new CryptoError(
					'roster_fork',
					`roster #${body.seq} does not extend the chain`,
				);
			}
			if (!activeAt(state, body.signer_member_id, body.seq)) {
				throw new CryptoError(
					'signature_invalid',
					`roster #${body.seq} signer is not active`,
				);
			}
			const signer = memberOrThrow(state, body.signer_member_id);
			await requireSignature(
				signer.signPub,
				wire.signature,
				ROSTER_CONTEXT,
				bytes,
				`roster #${body.seq}`,
			);
			applyStatement(state, body);
		}
		state.headSeq = body.seq;
		state.headHash = hash;
		state.heads.set(hash, body.seq);
	}

	if (!state) throw new CryptoError('roster_rollback', 'the roster is empty');
	if (
		!options.partial &&
		(countActive(state, 'password') !== 1 || countActive(state, 'recovery') !== 1)
	) {
		throw new CryptoError(
			'roster_fork',
			'account must keep one password and one recovery member',
		);
	}
	return state;
}

export function cloneState(state: RosterState): RosterState {
	return {
		...state,
		members: new Map([...state.members].map(([id, member]) => [id, { ...member }])),
		pouches: new Map([...state.pouches].map(([id, pouch]) => [id, { ...pouch }])),
		heads: new Map(state.heads),
	};
}

export function headOf(state: RosterState): RosterHead {
	return { seq: state.headSeq, hash: state.headHash };
}
