// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Account-level flows end to end, without a server: genesis, unlocking with
 * each secret, adding a CLI, revoking it, and the tamper checks a client
 * must apply to whatever the server hands back.
 */
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
	b64,
	buildAddMember,
	buildAuthorizeCli,
	buildCreatePouch,
	buildGenesis,
	buildRemoveMember,
	buildRenamePouch,
	buildReplaceSecretMember,
	cliConfirmCode,
	confirmCode,
	CryptoError,
	generateMemberKeyPair,
	generateRecoveryKey,
	jwkThumbprint,
	maySignRevision,
	memberEntry,
	openBlob,
	openKeyring,
	openPouchMeta,
	openRevision,
	openWelcome,
	assertMatchesRoster,
	newMemberSalt,
	passkeyMemberKeys,
	passwordSecret,
	pouchKeys,
	randomBytes,
	sealBlob,
	sealKeyEnvelope,
	sealRevision,
	secretMemberKeys,
	unb64,
	utf8,
	verifyRoster,
	type Keyring,
	type RosterStatementWire,
} from '../src';
import type { KeyEnvelopeInput, RosterStatementInput } from '@skillpouch/contracts';
import { blake3 } from '@noble/hashes/blake3.js';

const params = { alg: 'argon2id' as const, m: 19_456, t: 2, p: 1 };

/** A tiny in-memory "server": stores statements and envelopes exactly as the API would. */
class FakeServer {
	statements: RosterStatementWire[] = [];
	envelopes: KeyEnvelopeInput[] = [];

	append(inputs: RosterStatementInput[], envelopes: KeyEnvelopeInput[] = []) {
		for (const input of inputs) {
			const bytes = unb64(input.statement);
			this.statements.push({
				seq: this.statements.length,
				statement: input.statement,
				statement_hash: b64(blake3(bytes)),
				signature: input.signature,
			});
		}
		this.envelopes.push(...envelopes);
	}
}

async function setup() {
	const server = new FakeServer();
	const accountId = randomUUID();
	const browserKeys = await generateMemberKeyPair();
	const kdfSalt = randomBytes(16);
	const pepper = randomBytes(32);
	const recovery = generateRecoveryKey();
	const ids = {
		browser: randomUUID(),
		password: randomUUID(),
		recovery: randomUUID(),
		pouch: randomUUID(),
	};
	const genesis = await buildGenesis({
		accountId,
		browserMemberId: ids.browser,
		browserKeys,
		passwordSecret: await passwordSecret('violet-anchor-92', kdfSalt, params, pepper),
		passwordMemberId: ids.password,
		recoveryEntropy: recovery.entropy,
		recoveryMemberId: ids.recovery,
		pouchId: ids.pouch,
		pouch: { name: 'Personal', description: 'Everyday setup' },
	});
	server.append(genesis.request.statements, genesis.request.key_envelopes);
	return { server, accountId, browserKeys, kdfSalt, pepper, recovery, ids, genesis };
}

async function unlockWithPassword(
	ctx: Awaited<ReturnType<typeof setup>>,
	password: string,
): Promise<Keyring> {
	const roster = await verifyRoster(ctx.server.statements, {
		accountId: ctx.accountId,
		pinnedGenesisHash: ctx.genesis.genesisHash,
	});
	const member = roster.members.get(ctx.ids.password)!;
	const keys = await secretMemberKeys(
		'password',
		await passwordSecret(password, ctx.kdfSalt, params, ctx.pepper),
		unb64(member.memberSalt!),
	);
	if (keys.signPub.x !== member.signPub.x)
		throw new CryptoError('wrong_secret', 'wrong password');
	return openKeyring({ id: member.id, kind: 'password', keys }, roster, ctx.server.envelopes);
}

describe('account genesis', () => {
	it('produces a verifiable roster with three members and one pouch', async () => {
		const ctx = await setup();
		const roster = await verifyRoster(ctx.server.statements, {
			accountId: ctx.accountId,
			pinnedGenesisHash: ctx.genesis.genesisHash,
		});
		expect([...roster.members.values()].map((m) => m.kind).sort()).toEqual([
			'browser',
			'password',
			'recovery',
		]);
		expect(roster.pouches.get(ctx.ids.pouch)?.keyGen).toBe(1);
		expect(ctx.server.envelopes).toHaveLength(3);
		const keys = pouchKeys(ctx.genesis.keyring, ctx.ids.pouch);
		expect(openPouchMeta(keys, roster.pouches.get(ctx.ids.pouch)!.nameEnc!)).toEqual({
			name: 'Personal',
			description: 'Everyday setup',
		});
	});

	it('unlocks with the master password and with the Recovery Key — and not with a wrong one', async () => {
		const ctx = await setup();
		const viaPassword = await unlockWithPassword(ctx, 'violet-anchor-92');
		expect(pouchKeys(viaPassword, ctx.ids.pouch).current.keyGen).toBe(1);
		await expect(unlockWithPassword(ctx, 'violet-anchor-93')).rejects.toThrow(/wrong password/);

		const roster = await verifyRoster(ctx.server.statements, { accountId: ctx.accountId });
		const recoveryMember = roster.members.get(ctx.ids.recovery)!;
		const recoveryKeys = await secretMemberKeys(
			'recovery',
			ctx.recovery.entropy,
			unb64(recoveryMember.memberSalt!),
		);
		expect(recoveryKeys.signPub).toEqual(recoveryMember.signPub);
		const viaRecovery = await openKeyring(
			{ id: recoveryMember.id, kind: 'recovery', keys: recoveryKeys },
			roster,
			ctx.server.envelopes,
		);
		expect(pouchKeys(viaRecovery, ctx.ids.pouch).blobIdKey).toEqual(
			pouchKeys(viaPassword, ctx.ids.pouch).blobIdKey,
		);
	});

	it('rejects a roster whose genesis differs from the pinned hash', async () => {
		const ctx = await setup();
		const other = await setup();
		await expect(
			verifyRoster(other.server.statements, {
				accountId: other.accountId,
				pinnedGenesisHash: ctx.genesis.genesisHash,
			}),
		).rejects.toMatchObject({ kind: 'roster_fork' });
	});
});

describe('tamper detection', () => {
	it('rejects an edited statement, a forged signature and a reordered chain', async () => {
		const ctx = await setup();
		const [genesis, create] = ctx.server.statements as [
			RosterStatementWire,
			RosterStatementWire,
		];
		const edited = { ...create, statement: b64(utf8('{"format":1}')) };
		await expect(
			verifyRoster([genesis, edited], { accountId: ctx.accountId }),
		).rejects.toBeInstanceOf(CryptoError);

		const forged = { ...create, signature: genesis.signature };
		await expect(
			verifyRoster([genesis, forged], { accountId: ctx.accountId }),
		).rejects.toMatchObject({ kind: 'signature_invalid' });

		await expect(
			verifyRoster([{ ...create, seq: 0 }], { accountId: ctx.accountId }),
		).rejects.toMatchObject({ kind: 'roster_fork' });
	});

	it('rejects a roster that went backwards or a seen statement that changed', async () => {
		const ctx = await setup();
		const full = await verifyRoster(ctx.server.statements, { accountId: ctx.accountId });
		await expect(
			verifyRoster([], { accountId: ctx.accountId, previous: full, reportedHeadSeq: 0 }),
		).rejects.toMatchObject({ kind: 'roster_rollback' });
		const head = ctx.server.statements[1]!;
		await expect(
			verifyRoster([{ ...head, statement_hash: 'x' }], {
				accountId: ctx.accountId,
				previous: full,
			}),
		).rejects.toMatchObject({ kind: 'roster_fork' });
	});

	it('rejects key envelopes from non-members', async () => {
		const ctx = await setup();
		const keyring = await unlockWithPassword(ctx, 'violet-anchor-92');
		const stranger = await generateMemberKeyPair();
		const fake = { ...ctx.server.envelopes[0]!, created_by_member: randomUUID() };
		await expect(
			openKeyring(keyring.member, keyring.roster, [
				{ ...fake, member_id: keyring.member.id },
			]),
		).rejects.toMatchObject({ kind: 'signature_invalid' });
		expect(stranger).toBeTruthy();
	});

	it('rejects a revision moved to another artifact or signed by someone else', async () => {
		const ctx = await setup();
		const keyring = ctx.genesis.keyring;
		const keys = pouchKeys(keyring, ctx.ids.pouch);
		const blob = sealBlob(keys, utf8('# Skill'));
		const body = {
			format: 1 as const,
			artifact_id: randomUUID(),
			revision_id: randomUUID(),
			parent_id: null,
			merge_parent_id: null,
			kind: 'skill',
			scope: 'global',
			logical_key: 'pdf-tools',
			deleted: false,
			entries: [{ path: 'SKILL.md', blob: blob.id, size: blob.size, mode: 'file' as const }],
			roster_head: keyring.roster.headHash,
			author_member_id: keyring.member.id,
			created_at: new Date().toISOString(),
		};
		const sealed = await sealRevision(keys, keyring.member.keys, body);
		const columns = {
			artifact_id: body.artifact_id,
			revision_id: body.revision_id,
			parent_id: null,
			envelope: sealed.envelope,
			signature: sealed.signature,
			signer_member_id: keyring.member.id,
		};
		expect(await openRevision(keys, columns, keyring.member.keys.signPub)).toEqual(body);
		await expect(
			openRevision(
				keys,
				{ ...columns, artifact_id: randomUUID() },
				keyring.member.keys.signPub,
			),
		).rejects.toBeInstanceOf(CryptoError);
		const other = await generateMemberKeyPair();
		await expect(openRevision(keys, columns, other.signPub)).rejects.toMatchObject({
			kind: 'signature_invalid',
		});

		// The parent link: an emptied column (pruned history) is fine, another parent is not.
		const parentId = randomUUID();
		const child = { ...body, revision_id: randomUUID(), parent_id: parentId };
		const sealedChild = await sealRevision(keys, keyring.member.keys, child);
		const childColumns = {
			...columns,
			revision_id: child.revision_id,
			parent_id: parentId,
			envelope: sealedChild.envelope,
			signature: sealedChild.signature,
		};
		const signPub = keyring.member.keys.signPub;
		expect(await openRevision(keys, childColumns, signPub)).toEqual(child);
		expect(await openRevision(keys, { ...childColumns, parent_id: null }, signPub)).toEqual(
			child,
		);
		await expect(
			openRevision(keys, { ...childColumns, parent_id: randomUUID() }, signPub),
		).rejects.toMatchObject({ kind: 'envelope_mismatch' });
		await expect(
			openRevision(keys, { ...columns, parent_id: randomUUID() }, signPub),
		).rejects.toMatchObject({ kind: 'envelope_mismatch' });
		expect(new TextDecoder().decode(openBlob(keys, blob.id, blob.bytes))).toBe('# Skill');
	});

	it('takes pouch keys only as the roster announced them', async () => {
		const ctx = await setup();
		const keyring = ctx.genesis.keyring;
		const cli = await generateMemberKeyPair();
		const cliId = randomUUID();
		const added = await buildAddMember(keyring, memberEntry(cliId, 'device', cli));
		ctx.server.append([added.statement.input], added.key_envelopes);
		const removal = await buildRemoveMember(keyring, cliId);
		ctx.server.append(removal.statements, removal.key_envelopes);
		const roster = await verifyRoster(ctx.server.statements, { accountId: ctx.accountId });
		const me = keyring.member;
		const mine = ctx.server.envelopes.filter((e) => e.member_id === me.id);
		const material = keyring.material.get(ctx.ids.pouch)!;
		const forge = (
			creator: { id: string; signKey: CryptoKey },
			keyGen: number,
			pis?: Uint8Array,
		) =>
			sealKeyEnvelope(creator, { id: me.id, encPub: me.keys.encPub }, ctx.ids.pouch, keyGen, {
				ps: randomBytes(32),
				pis: pis ?? material.get(1)!.pis,
			});
		const self = { id: me.id, signKey: me.keys.signKey };
		const open = (envelopes: KeyEnvelopeInput[]) => openKeyring(me, roster, envelopes);

		expect(pouchKeys(await open(mine), ctx.ids.pouch).current.keyGen).toBe(2);
		await expect(open([...mine, await forge(self, 3)])).rejects.toMatchObject({
			kind: 'envelope_mismatch',
		});
		await expect(
			open([
				...mine.filter((e) => e.key_gen !== 2),
				await forge({ id: cliId, signKey: cli.signKey }, 2),
			]),
		).rejects.toMatchObject({ kind: 'signature_invalid' });
		await expect(open([...mine, await forge(self, 2)])).rejects.toMatchObject({
			kind: 'envelope_mismatch',
		});
		await expect(
			open([...mine.filter((e) => e.key_gen !== 2), await forge(self, 2, randomBytes(32))]),
		).rejects.toMatchObject({ kind: 'envelope_mismatch' });
		await expect(open(mine.filter((e) => e.key_gen !== 2))).rejects.toMatchObject({
			kind: 'roster_rollback',
		});
	});

	it('lets a member sign revisions only for the roster heads it was a member at', async () => {
		const ctx = await setup();
		const keyring = ctx.genesis.keyring;
		const before = keyring.roster.headHash;
		const cliId = randomUUID();
		await buildAddMember(keyring, memberEntry(cliId, 'device', await generateMemberKeyPair()));
		const added = keyring.roster.headHash;
		await buildRemoveMember(keyring, cliId);
		const roster = keyring.roster;
		expect(maySignRevision(roster, cliId, added)).toBe(true);
		expect(maySignRevision(roster, cliId, before)).toBe(false);
		expect(maySignRevision(roster, cliId, roster.headHash)).toBe(false);
		expect(maySignRevision(roster, cliId, 'unknown')).toBe(false);
		expect(maySignRevision(roster, keyring.member.id, 'unknown')).toBe(true);
		expect(maySignRevision(roster, randomUUID(), added)).toBe(false);
	});
});

describe('authorize CLI and revoke', () => {
	it('lets an authorized CLI open its welcome and every pouch key, then locks it out after removal', async () => {
		const ctx = await setup();
		const keyring = ctx.genesis.keyring;
		const second = randomUUID();
		const created = await buildCreatePouch(keyring, second, { name: 'Work', description: '' });
		ctx.server.append([created.statement], created.key_envelopes);

		const cliKeys = await generateMemberKeyPair();
		const requestId = randomUUID();
		const request = {
			requestId,
			signPub: cliKeys.signPub,
			encPub: cliKeys.encPub,
			keyStorage: 'file' as const,
		};
		expect(cliConfirmCode(request)).toBe(
			confirmCode(requestId, cliKeys.signPub, cliKeys.encPub, jwkThumbprint(cliKeys.signPub)),
		);
		const deviceId = randomUUID();
		const authorized = await buildAuthorizeCli(keyring, request, deviceId);
		ctx.server.append([authorized.statement], authorized.key_envelopes);

		const welcome = await openWelcome(cliKeys, deviceId, authorized.welcome);
		expect(welcome.genesis_hash).toBe(ctx.genesis.genesisHash);
		const roster = await verifyRoster(ctx.server.statements, {
			accountId: ctx.accountId,
			pinnedGenesisHash: welcome.genesis_hash,
		});
		expect(roster.headSeq).toBe(welcome.roster_head_seq);
		const cli = await openKeyring(
			{ id: deviceId, kind: 'device', keys: cliKeys },
			roster,
			ctx.server.envelopes,
		);
		expect([...cli.pouches.keys()].sort()).toEqual([ctx.ids.pouch, second].sort());

		const rename = await buildRenamePouch(keyring, second, {
			name: 'Work stuff',
			description: 'x',
		});
		ctx.server.append([rename.statement]);

		const removal = await buildRemoveMember(keyring, deviceId);
		ctx.server.append(removal.statements, removal.key_envelopes);
		const after = await verifyRoster(ctx.server.statements, { accountId: ctx.accountId });
		expect(after.members.get(deviceId)?.removedSeq).not.toBeNull();
		expect(after.pouches.get(second)?.keyGen).toBe(2);
		expect(
			openPouchMeta(pouchKeys(keyring, second), after.pouches.get(second)!.nameEnc!).name,
		).toBe('Work stuff');

		// The removed CLI received no generation-2 envelopes.
		const cliAfter = await openKeyring(cli.member, after, ctx.server.envelopes);
		expect(pouchKeys(cliAfter, ctx.ids.pouch).current.keyGen).toBe(1);
		const browserAfter = await openKeyring(keyring.member, after, ctx.server.envelopes);
		expect(pouchKeys(browserAfter, ctx.ids.pouch).current.keyGen).toBe(2);
	});

	it('a welcome for one device does not open for another', async () => {
		const ctx = await setup();
		const cliKeys = await generateMemberKeyPair();
		const deviceId = randomUUID();
		const { welcome } = await buildAuthorizeCli(
			ctx.genesis.keyring,
			{
				requestId: randomUUID(),
				signPub: cliKeys.signPub,
				encPub: cliKeys.encPub,
				keyStorage: 'file',
			},
			deviceId,
		);
		await expect(openWelcome(cliKeys, randomUUID(), welcome)).rejects.toBeInstanceOf(
			CryptoError,
		);
	});

	it('adds a new trusted browser signed by the member that unlocked it', async () => {
		const ctx = await setup();
		const unlocked = await unlockWithPassword(ctx, 'violet-anchor-92');
		const newBrowser = await generateMemberKeyPair();
		const id = randomUUID();
		const { statement, key_envelopes } = await buildAddMember(
			unlocked,
			memberEntry(id, 'browser', newBrowser),
		);
		ctx.server.append([statement.input], key_envelopes);
		const roster = await verifyRoster(ctx.server.statements, { accountId: ctx.accountId });
		const browser = await openKeyring(
			{ id, kind: 'browser', keys: newBrowser },
			roster,
			ctx.server.envelopes,
		);
		expect(browser.pouches.size).toBe(1);
	});

	it('replaces the master password: the new one opens every pouch, the old one opens nothing new', async () => {
		const ctx = await setup();
		const keyring = ctx.genesis.keyring;
		const salt = randomBytes(16);
		const newKeys = await secretMemberKeys(
			'password',
			await passwordSecret('new-harbor-lights-31', ctx.kdfSalt, params, ctx.pepper),
			salt,
		);
		const newId = randomUUID();
		const change = await buildReplaceSecretMember(
			keyring,
			ctx.ids.password,
			memberEntry(newId, 'password', newKeys, { memberSalt: b64(salt) }),
		);
		ctx.server.append(change.statements, change.key_envelopes);

		const roster = await verifyRoster(ctx.server.statements, { accountId: ctx.accountId });
		expect(roster.members.get(ctx.ids.password)!.removedSeq).not.toBeNull();
		const opened = await openKeyring(
			{ id: newId, kind: 'password', keys: newKeys },
			roster,
			ctx.server.envelopes,
		);
		const keys = pouchKeys(opened, ctx.ids.pouch);
		expect(keys.current.keyGen).toBe(2);

		// Halfway through (new member added, old not removed yet) the chain is not a valid account.
		await expect(
			verifyRoster(ctx.server.statements.slice(0, -2), { accountId: ctx.accountId }),
		).rejects.toThrow(/one password and one recovery/);
	});

	it('a passkey member opens the same pouch keys from its PRF output — and nothing from a wrong one', async () => {
		const ctx = await setup();
		const prf = randomBytes(32);
		const salt = newMemberSalt();
		const passkeyId = randomUUID();
		const added = await buildAddMember(
			ctx.genesis.keyring,
			memberEntry(passkeyId, 'passkey', await passkeyMemberKeys(prf, salt), {
				memberSalt: b64(salt),
			}),
		);
		ctx.server.append([added.statement.input], added.key_envelopes);
		expect(added.key_envelopes.map((envelope) => envelope.member_id)).toEqual([passkeyId]);

		const roster = await verifyRoster(ctx.server.statements, { accountId: ctx.accountId });
		const member = roster.members.get(passkeyId)!;
		expect(member.kind).toBe('passkey');
		// The browser re-derives from what the server keeps: the salt and the PRF input.
		const unlocked = await passkeyMemberKeys(prf, unb64(member.memberSalt!));
		assertMatchesRoster(unlocked, member.signPub);
		const viaPasskey = await openKeyring(
			{ id: passkeyId, kind: 'passkey', keys: unlocked },
			roster,
			ctx.server.envelopes,
		);
		expect(pouchKeys(viaPasskey, ctx.ids.pouch).current).toEqual(
			pouchKeys(ctx.genesis.keyring, ctx.ids.pouch).current,
		);

		const wrong = await passkeyMemberKeys(randomBytes(32), unb64(member.memberSalt!));
		expect(() => assertMatchesRoster(wrong, member.signPub)).toThrow(/does not match/);
		await expect(
			openKeyring(
				{ id: passkeyId, kind: 'passkey', keys: wrong },
				roster,
				ctx.server.envelopes,
			),
		).rejects.toBeInstanceOf(Error);

		// Removing the passkey rotates every pouch: the old PRF opens nothing newer.
		const removal = await buildRemoveMember(ctx.genesis.keyring, passkeyId);
		ctx.server.append(removal.statements, removal.key_envelopes);
		expect(removal.key_envelopes.some((envelope) => envelope.member_id === passkeyId)).toBe(
			false,
		);
		const after = await verifyRoster(ctx.server.statements, { accountId: ctx.accountId });
		const stale = await openKeyring(
			{ id: passkeyId, kind: 'passkey', keys: unlocked },
			after,
			ctx.server.envelopes,
		);
		expect(pouchKeys(stale, ctx.ids.pouch).current.keyGen).toBe(1);
		expect(after.pouches.get(ctx.ids.pouch)!.keyGen).toBe(2);
	});

	it('replaces the Recovery Key the same way', async () => {
		const ctx = await setup();
		const next = generateRecoveryKey();
		const salt = randomBytes(16);
		const keys = await secretMemberKeys('recovery', next.entropy, salt);
		const change = await buildReplaceSecretMember(
			ctx.genesis.keyring,
			ctx.ids.recovery,
			memberEntry(randomUUID(), 'recovery', keys, { memberSalt: b64(salt) }),
		);
		ctx.server.append(change.statements, change.key_envelopes);
		const roster = await verifyRoster(ctx.server.statements, { accountId: ctx.accountId });
		expect(roster.members.get(ctx.ids.recovery)!.removedSeq).not.toBeNull();
	});
});
