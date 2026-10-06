// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Request builders for every roster-changing flow. They are pure: each
 * returns the exact body for one API call plus the updated keyring, and
 * never talks to the network, so the browser and the test tools share them.
 */
import type { KeyEnvelopeInput, RosterMember, RosterStatementInput } from '@skillpouch/contracts';
import { b64 } from './bytes';
import { confirmCode, sealWelcome, type Welcome } from './cli-login';
import {
	createPouchSecrets,
	recipientsOf,
	rotateAll,
	sealAllFor,
	type Keyring,
	type Member,
} from './keyring';
import { jwkThumbprint, type MemberKeyPair, type PublicJwk } from './keys';
import { sealPouchMeta, type PouchMeta } from './pouch-meta';
import {
	activeMembers,
	headOf,
	memberEntry,
	signStatement,
	verifyRoster,
	type RosterHead,
	type RosterStatementWire,
	type SignedStatement,
} from './roster';
import { newMemberSalt, secretMemberKeys } from './secrets';

export interface RosterChange {
	statements: RosterStatementInput[];
	key_envelopes: KeyEnvelopeInput[];
}

const wire = (signed: SignedStatement[]): RosterStatementWire[] =>
	signed.map((s) => ({
		seq: s.body.seq,
		statement: s.input.statement,
		statement_hash: s.hash,
		signature: s.input.signature,
	}));

/** Applies freshly signed statements to the keyring's roster (re-verified, never trusted blindly). */
async function advance(
	keyring: Keyring,
	signed: SignedStatement[],
	options: { partial?: boolean } = {},
): Promise<void> {
	keyring.roster = await verifyRoster(wire(signed), {
		accountId: keyring.roster.accountId,
		previous: keyring.roster,
		...options,
	});
}

// ---- genesis -------------------------------------------------------------------------

export interface GenesisInput {
	accountId: string;
	browserMemberId: string;
	browserKeys: MemberKeyPair;
	/** `passwordSecret(...)` output: Argon2id(password) ‖ pepper. */
	passwordSecret: Uint8Array;
	passwordMemberId: string;
	recoveryEntropy: Uint8Array;
	recoveryMemberId: string;
	pouchId: string;
	pouch: PouchMeta;
}

export interface GenesisResult {
	request: RosterChange;
	keyring: Keyring;
	genesisHash: string;
}

/** Statement #0 (browser + password + recovery members) and #1 (first pouch), plus envelopes. */
export async function buildGenesis(input: GenesisInput): Promise<GenesisResult> {
	const passwordSalt = newMemberSalt();
	const recoverySalt = newMemberSalt();
	const passwordKeys = await secretMemberKeys('password', input.passwordSecret, passwordSalt);
	const recoveryKeys = await secretMemberKeys('recovery', input.recoveryEntropy, recoverySalt);
	const browser: Member = { id: input.browserMemberId, kind: 'browser', keys: input.browserKeys };
	const signer = { id: browser.id, signKey: browser.keys.signKey };
	const head: RosterHead = { seq: -1, hash: null };

	const genesis = await signStatement(signer, input.accountId, head, {
		action: 'genesis',
		members: [
			memberEntry(browser.id, 'browser', input.browserKeys),
			memberEntry(input.passwordMemberId, 'password', passwordKeys, {
				memberSalt: b64(passwordSalt),
			}),
			memberEntry(input.recoveryMemberId, 'recovery', recoveryKeys, {
				memberSalt: b64(recoverySalt),
			}),
		],
	});
	const roster = await verifyRoster(wire([genesis]), { accountId: input.accountId });
	const keyring: Keyring = { member: browser, roster, material: new Map(), pouches: new Map() };

	const envelopes = await createPouchSecrets(keyring, input.pouchId);
	const createPouch = await signStatement(signer, input.accountId, head, {
		action: 'create_pouch',
		pouch: {
			id: input.pouchId,
			name_enc: sealPouchMeta(keyring.pouches.get(input.pouchId)!, input.pouch),
		},
	});
	await advance(keyring, [createPouch]);
	return {
		request: { statements: [genesis.input, createPouch.input], key_envelopes: envelopes },
		keyring,
		genesisHash: genesis.hash,
	};
}

// ---- pouches ----------------------------------------------------------------------------

export async function buildCreatePouch(
	keyring: Keyring,
	pouchId: string,
	meta: PouchMeta,
): Promise<{ statement: RosterStatementInput; key_envelopes: KeyEnvelopeInput[] }> {
	const recipients = recipientsOf(activeMembers(keyring.roster));
	const envelopes = await createPouchSecrets(keyring, pouchId, recipients);
	const head = headOf(keyring.roster);
	const statement = await signStatement(signerOf(keyring), keyring.roster.accountId, head, {
		action: 'create_pouch',
		pouch: { id: pouchId, name_enc: sealPouchMeta(keyring.pouches.get(pouchId)!, meta) },
	});
	await advance(keyring, [statement]);
	return { statement: statement.input, key_envelopes: envelopes };
}

export async function buildRenamePouch(
	keyring: Keyring,
	pouchId: string,
	meta: PouchMeta,
): Promise<{ statement: RosterStatementInput }> {
	const keys = keyring.pouches.get(pouchId);
	if (!keys) throw new Error('pouch keys not loaded');
	const statement = await signStatement(
		signerOf(keyring),
		keyring.roster.accountId,
		headOf(keyring.roster),
		{ action: 'rename_pouch', pouch: { id: pouchId, name_enc: sealPouchMeta(keys, meta) } },
	);
	await advance(keyring, [statement]);
	return { statement: statement.input };
}

// ---- members -------------------------------------------------------------------------

const signerOf = (keyring: Keyring) => ({
	id: keyring.member.id,
	signKey: keyring.member.keys.signKey,
});

/**
 * `add(member)` signed by this keyring's member, plus envelopes for every
 * pouch and generation it holds — used for new browsers, CLIs and passkeys.
 */
export async function buildAddMember(
	keyring: Keyring,
	entry: RosterMember,
): Promise<{ statement: SignedStatement; key_envelopes: KeyEnvelopeInput[] }> {
	const statement = await signStatement(
		signerOf(keyring),
		keyring.roster.accountId,
		headOf(keyring.roster),
		{ action: 'add', member: entry },
	);
	const key_envelopes = await sealAllFor(keyring, [
		{ id: entry.id, encPub: entry.enc_pub as PublicJwk },
	]);
	await advance(keyring, [statement]);
	return { statement, key_envelopes };
}

/** The roster entry + envelopes + welcome for "Authorize CLI". */
export interface CliRequestKeys {
	requestId: string;
	signPub: PublicJwk;
	encPub: PublicJwk;
	keyStorage: NonNullable<RosterMember['key_storage']>;
}

export async function buildAuthorizeCli(
	keyring: Keyring,
	request: CliRequestKeys,
	deviceMemberId: string,
): Promise<{
	statement: RosterStatementInput;
	welcome: string;
	key_envelopes: KeyEnvelopeInput[];
}> {
	const { statement, key_envelopes } = await buildAddMember(
		keyring,
		memberEntry(deviceMemberId, 'device', request, { keyStorage: request.keyStorage }),
	);
	const welcome: Welcome = {
		format: 1,
		account_id: keyring.roster.accountId,
		genesis_hash: keyring.roster.genesisHash,
		roster_head_seq: keyring.roster.headSeq,
		roster_head_hash: keyring.roster.headHash,
		member_id: deviceMemberId,
	};
	return {
		statement: statement.input,
		welcome: await sealWelcome(request.encPub, welcome),
		key_envelopes,
	};
}

export function cliConfirmCode(request: Omit<CliRequestKeys, 'keyStorage'>): string {
	return confirmCode(
		request.requestId,
		request.signPub,
		request.encPub,
		jwkThumbprint(request.signPub),
	);
}

/**
 * `remove(member)` + `rotate_keys`: every pouch moves to a new generation
 * sealed only to the members that remain.
 */
export async function buildRemoveMember(keyring: Keyring, memberId: string): Promise<RosterChange> {
	const head = headOf(keyring.roster);
	const remove = await signStatement(signerOf(keyring), keyring.roster.accountId, head, {
		action: 'remove',
		member_id: memberId,
	});
	const remaining = activeMembers(keyring.roster).filter((member) => member.id !== memberId);
	const { newGenerations, envelopes } = await rotateAll(keyring, recipientsOf(remaining));
	const rotate = await signStatement(signerOf(keyring), keyring.roster.accountId, head, {
		action: 'rotate_keys',
		new_generations: newGenerations,
	});
	await advance(keyring, [remove, rotate]);
	return { statements: [remove.input, rotate.input], key_envelopes: envelopes };
}

/**
 * Replaces a secret member (new master password, new Recovery Key): adds
 * the new member, removes the old one and rotates every pouch.
 */
export async function buildReplaceSecretMember(
	keyring: Keyring,
	oldMemberId: string,
	entry: RosterMember,
): Promise<RosterChange> {
	const head = headOf(keyring.roster);
	const add = await signStatement(signerOf(keyring), keyring.roster.accountId, head, {
		action: 'add',
		member: entry,
	});
	const addEnvelopes = await sealAllFor(keyring, [
		{ id: entry.id, encPub: entry.enc_pub as PublicJwk },
	]);
	// Two members of this kind until the removal below: checked once the batch is complete.
	await advance(keyring, [add], { partial: true });
	const rest = await buildRemoveMember(keyring, oldMemberId);
	return {
		statements: [add.input, ...rest.statements],
		key_envelopes: [...addEnvelopes, ...rest.key_envelopes],
	};
}
