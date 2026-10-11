// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The web client against a server that lies (`src/test/evil-server.ts`).
 * Real crypto end to end: the roster, key envelopes, revisions and blobs
 * are built by `@skillpouch/crypto`, served through the real API client,
 * and tampered with one at a time. Each case must fail with the right
 * `CryptoError` kind and be reported to `POST /v1/security/reports`.
 */
import { canonicalJson } from '@skillpouch/contracts';
import {
	CryptoError,
	REVISION_SIG_CONTEXT,
	b64,
	blake3Hash,
	buildAddMember,
	buildGenesis,
	concat,
	generateMemberKeyPair,
	memberEntry,
	newMemberSalt,
	openKeyring,
	passkeyMemberKeys,
	pouchKeys,
	prfInput,
	randomBytes,
	seal,
	sealKeyEnvelope,
	sign,
	unb64,
	type CryptoErrorKind,
	type Keyring,
	type MemberKeyPair,
} from '@skillpouch/crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	addMember,
	flip,
	honestAccount,
	removeMember,
	type HonestAccount,
	type ServedArtifact,
} from '@/test/evil-server';
import { fetchBlobs, loadPouchContents } from '../../ingredients/ingredients';
import { commitIngredient } from '../../ingredients/write';
import { loadConflictVersions } from '../../conflicts/conflicts';
import { setSession } from '../../session/session-store';
import { findBrowserMember, openBrowserKeyring } from '../../session/bootstrap';
import { saveBrowserKey, type StoredBrowserKey } from '../key-store';
import { classify, remember, type SeenHead } from '../head-pins';
import { PasskeyError, openWithPasskey } from '../passkeys';
import { loadVerifiedRoster } from '../roster';
import { resetTamperReports } from '../security-report';
import { openWithSecret, type UnlockContext } from '../unlock';

let account: HonestAccount;

beforeEach(async () => {
	resetTamperReports();
	account = await honestAccount();
	vi.stubGlobal('fetch', account.server.fetch);
});

afterEach(() => {
	setSession({ status: 'signed_out' });
	vi.unstubAllGlobals();
});

async function storedBrowser(keys: MemberKeyPair, memberId: string | null) {
	const record: StoredBrowserKey = {
		userId: crypto.randomUUID(),
		keys,
		memberId,
		trusted: true,
		pinnedGenesisHash: null,
		pinnedHeadSeq: -1,
		pinnedHeadHash: null,
		createdAt: '2026-10-10T00:00:00.000Z',
	};
	await saveBrowserKey(record);
	return record;
}

/** The account's own browser, as bootstrap opens it on a reload. */
async function thisBrowser() {
	return storedBrowser(account.browserKeys, account.keyring.member.id);
}

async function openAsBrowser(browser: StoredBrowserKey): Promise<Keyring> {
	const roster = await loadVerifiedRoster(account.accountId, browser);
	const member = findBrowserMember(roster, browser);
	if (!member) throw new Error('not a member');
	return openBrowserKeyring(roster, browser, member);
}

/** The client refused with `kind`, and told the API so. */
async function refusedAndReported(work: Promise<unknown>, kind: CryptoErrorKind, pouchId?: string) {
	const error = await work.then(
		() => null,
		(caught: unknown) => caught,
	);
	expect(error, `accepted what should fail with ${kind}`).toBeInstanceOf(CryptoError);
	expect((error as CryptoError).kind).toBe(kind);
	await expectReport(kind, pouchId);
}

async function expectReport(kind: CryptoErrorKind, pouchId?: string) {
	await vi.waitFor(() =>
		expect(account.server.reports).toContainEqual(
			expect.objectContaining({ kind, ...(pouchId ? { pouch_id: pouchId } : {}) }),
		),
	);
}

const material = (gen = 1) => account.keyring.material.get(account.pouchId)!.get(gen)!;
const browserSigner = () => ({
	id: account.keyring.member.id,
	signKey: account.browserKeys.signKey,
});

describe('an honest server', () => {
	it('opens the roster, the keys, the items and their files, and nothing is reported', async () => {
		await account.server.putItem(account.keyring, account.pouchId, 'pdf', '# PDF\n');
		const keyring = await openAsBrowser(await thisBrowser());
		const contents = await loadPouchContents(keyring, account.pouchId);
		expect(contents.unreadable).toEqual([]);
		expect(contents.ingredients.map((i) => i.name)).toEqual(['pdf']);
		const files = await fetchBlobs(
			keyring,
			account.pouchId,
			contents.ingredients[0]!.files.map((f) => f.blob),
		);
		expect(new TextDecoder().decode([...files.values()][0])).toBe('# PDF\n');
		expect(account.server.reports).toEqual([]);
	});
});

describe('the roster', () => {
	it('refuses a member added with a signature that is not the claimed signer’s', async () => {
		const intruder = await generateMemberKeyPair();
		account.server.statements.push(
			await account.server.forge(
				account.accountId,
				{ id: account.keyring.member.id, signKey: intruder.signKey },
				{ action: 'add', member: memberEntry(crypto.randomUUID(), 'browser', intruder) },
			),
		);
		await refusedAndReported(openAsBrowser(await thisBrowser()), 'signature_invalid');
	});

	it('refuses a member signed in by someone who is not a member', async () => {
		const intruder = await generateMemberKeyPair();
		const id = crypto.randomUUID();
		account.server.statements.push(
			await account.server.forge(
				account.accountId,
				{ id, signKey: intruder.signKey },
				{ action: 'add', member: memberEntry(id, 'browser', intruder) },
			),
		);
		await refusedAndReported(openAsBrowser(await thisBrowser()), 'signature_invalid');
	});

	it('refuses a statement the server edited and re-hashed', async () => {
		const last = account.server.statements.at(-1)!;
		const body = JSON.parse(new TextDecoder().decode(unb64(last.statement)));
		body.created_at = '2027-01-01T00:00:00.000Z';
		const edited = new TextEncoder().encode(canonicalJson(body));
		account.server.statements[last.seq] = {
			...last,
			statement: b64(edited),
			statement_hash: b64(blake3Hash(edited)),
		};
		await refusedAndReported(openAsBrowser(await thisBrowser()), 'signature_invalid');
	});

	it('refuses reordered and replayed statements', async () => {
		await addMember(account, 'device');
		const honest = account.server.statements;
		const reordered = honest.map((wire) => ({ ...wire }));
		[reordered[1], reordered[2]] = [reordered[2]!, reordered[1]!];
		reordered[1]!.seq = 1;
		reordered[2]!.seq = 2;
		account.server.statements = reordered;
		await refusedAndReported(openAsBrowser(await thisBrowser()), 'roster_fork');

		account.server.statements = [...honest, { ...honest[1]!, seq: honest.length }];
		await expect(openAsBrowser(await thisBrowser())).rejects.toMatchObject({
			kind: 'roster_fork',
		});
	});

	it('refuses a roster rolled back below what this browser saw', async () => {
		const browser = await thisBrowser();
		await addMember(account, 'device');
		await openAsBrowser(browser);
		account.server.statements.pop();
		await refusedAndReported(openAsBrowser(browser), 'roster_rollback');
	});

	it('refuses a fork: another statement at a seq this browser already saw', async () => {
		const browser = await thisBrowser();
		const before = [...account.server.statements];
		await addMember(account, 'device');
		await openAsBrowser(browser);

		// The same signer, a different member at the same position.
		account.server.statements = before;
		const other = await generateMemberKeyPair();
		account.server.statements.push(
			await account.server.forge(account.accountId, browserSigner(), {
				action: 'add',
				member: memberEntry(crypto.randomUUID(), 'device', other, { keyStorage: 'file' }),
			}),
		);
		await refusedAndReported(openAsBrowser(browser), 'roster_fork');
	});

	it('refuses another genesis for the same account, and another account’s roster', async () => {
		const browser = await thisBrowser();
		await openAsBrowser(browser);
		const honest = account.server.statements;

		const other = await honestAccount();
		account.server.statements = other.server.statements;
		await refusedAndReported(openAsBrowser(browser), 'roster_fork');
		expect(account.server.reports[0]?.details.message).toMatch(/another account/);

		// A whole new, validly signed history for this account id ("pouch reset").
		const forged = await buildGenesis({
			accountId: account.accountId,
			browserMemberId: crypto.randomUUID(),
			browserKeys: await generateMemberKeyPair(),
			passwordSecret: randomBytes(64),
			passwordMemberId: crypto.randomUUID(),
			recoveryEntropy: randomBytes(16),
			recoveryMemberId: crypto.randomUUID(),
			pouchId: account.pouchId,
			pouch: { name: 'Personal', description: '' },
		});
		account.server.statements = [];
		account.server.append(forged.request.statements);
		await expect(openAsBrowser(browser)).rejects.toMatchObject({
			kind: 'roster_fork',
			message: expect.stringMatching(/genesis differs/),
		});
		account.server.statements = honest;
		await openAsBrowser(browser);
	});
});

describe('key envelopes', () => {
	async function withEnvelopes(edit: (envelopes: typeof account.server.envelopes) => void) {
		edit(account.server.envelopes);
		return openAsBrowser(await thisBrowser());
	}

	const myEnvelope = (gen: number) =>
		account.server.envelopes.findIndex(
			(e) =>
				e.member_id === account.keyring.member.id &&
				e.pouch_id === account.pouchId &&
				e.key_gen === gen,
		);

	const recipient = () => ({
		id: account.keyring.member.id,
		encPub: account.browserKeys.encPub,
	});

	it('refuses an envelope sealed by someone outside the roster', async () => {
		const stranger = await generateMemberKeyPair();
		const forged = await sealKeyEnvelope(
			{ id: crypto.randomUUID(), signKey: stranger.signKey },
			recipient(),
			account.pouchId,
			1,
			{ ...material(), ps: randomBytes(32) },
		);
		await refusedAndReported(
			withEnvelopes((all) => all.splice(myEnvelope(1), 1, forged)),
			'signature_invalid',
		);
	});

	it('refuses an envelope relabelled for this browser that was sealed for another member', async () => {
		const other = await generateMemberKeyPair();
		const sealed = await sealKeyEnvelope(
			browserSigner(),
			{ id: crypto.randomUUID(), encPub: other.encPub },
			account.pouchId,
			1,
			material(),
		);
		await refusedAndReported(
			withEnvelopes((all) =>
				all.splice(myEnvelope(1), 1, { ...sealed, member_id: account.keyring.member.id }),
			),
			'signature_invalid',
		);
	});

	it('refuses a bit-flipped envelope', async () => {
		await refusedAndReported(
			withEnvelopes((all) => {
				const at = myEnvelope(1);
				all[at] = { ...all[at]!, ciphertext: flip(all[at]!.ciphertext) };
			}),
			'signature_invalid',
		);
	});

	it('refuses the newest key from a member removed before it existed (a substituted pouch key)', async () => {
		const gone = await addMember(account, 'device');
		await removeMember(account, gone.id);
		const forged = await sealKeyEnvelope(
			{ id: gone.id, signKey: gone.keys.signKey },
			recipient(),
			account.pouchId,
			2,
			{ ...material(2), ps: randomBytes(32) },
		);
		await refusedAndReported(
			withEnvelopes((all) => all.splice(myEnvelope(2), 1, forged)),
			'signature_invalid',
		);
	});

	it('refuses a generation no rotate_keys announced', async () => {
		const ahead = await sealKeyEnvelope(browserSigner(), recipient(), account.pouchId, 5, {
			...material(),
			ps: randomBytes(32),
		});
		await refusedAndReported(
			withEnvelopes((all) => all.push(ahead)),
			'envelope_mismatch',
		);
	});

	it('refuses two different keys for one generation, or two identity secrets for one pouch', async () => {
		const second = await sealKeyEnvelope(browserSigner(), recipient(), account.pouchId, 1, {
			...material(),
			ps: randomBytes(32),
		});
		await refusedAndReported(
			withEnvelopes((all) => all.push(second)),
			'envelope_mismatch',
		);
		account.server.envelopes.pop();

		const gone = await addMember(account, 'device');
		await removeMember(account, gone.id);
		const otherIdentity = await sealKeyEnvelope(
			browserSigner(),
			recipient(),
			account.pouchId,
			2,
			{
				ps: material(2).ps,
				pis: randomBytes(32),
			},
		);
		await expect(
			withEnvelopes((all) => all.splice(myEnvelope(2), 1, otherIdentity)),
		).rejects.toMatchObject({
			kind: 'envelope_mismatch',
			message: expect.stringMatching(/two identity secrets/),
		});
	});

	it('refuses to open a pouch whose newest key generation was withheld (a downgrade)', async () => {
		const gone = await addMember(account, 'device');
		await removeMember(account, gone.id);
		await refusedAndReported(
			withEnvelopes((all) => all.splice(myEnvelope(2), 1)),
			'roster_rollback',
		);
	});

	it('a removed member’s keyring still stops at the generation it had, without a false alarm', async () => {
		const gone = await addMember(account, 'device');
		await removeMember(account, gone.id);
		const keyring = await openKeyring(
			{ id: gone.id, kind: 'device', keys: gone.keys },
			account.keyring.roster,
			account.server.envelopes,
		);
		expect(pouchKeys(keyring, account.pouchId).current.keyGen).toBe(1);
	});
});

describe('revisions', () => {
	async function contents() {
		const keyring = await openAsBrowser(await thisBrowser());
		return loadPouchContents(keyring, account.pouchId);
	}

	async function tamperedHead(
		edit: (
			head: NonNullable<(typeof account.server.artifacts)[number]['head']>,
		) => void | Promise<void>,
		kind: CryptoErrorKind,
	) {
		const artifact = await account.server.putItem(
			account.keyring,
			account.pouchId,
			'pdf',
			'# PDF\n',
		);
		await account.server.putItem(account.keyring, account.pouchId, 'ok', 'fine\n');
		await edit(artifact.head!);
		const result = await contents();
		expect(result.ingredients.map((i) => i.name)).toContain('ok');
		expect(result.ingredients.map((i) => i.name)).not.toContain('pdf');
		expect(result.unreadable.map((u) => u.id)).toEqual([artifact.id]);
		await expectReport(kind, account.pouchId);
		return result;
	}

	async function resign(
		head: { id: string; envelope: string; signature: string },
		keys = account.browserKeys,
	) {
		head.signature = await sign(
			keys.signKey,
			REVISION_SIG_CONTEXT,
			concat(account.pouchId, head.id, blake3Hash(unb64(head.envelope))),
		);
	}

	it('refuses a flipped signature', async () => {
		await tamperedHead((head) => {
			head.signature = flip(head.signature);
		}, 'signature_invalid');
	});

	it('refuses a flipped envelope', async () => {
		await tamperedHead((head) => {
			head.envelope = flip(head.envelope, 40);
		}, 'signature_invalid');
	});

	it('refuses ciphertext that fails authentication even under a valid signature', async () => {
		await tamperedHead(async (head) => {
			head.envelope = flip(head.envelope, unb64(head.envelope).length - 1);
			await resign(head);
		}, 'aead_failure');
	});

	it('refuses an envelope moved to another artifact', async () => {
		const other = await account.server.putItem(
			account.keyring,
			account.pouchId,
			'other',
			'x\n',
		);
		await tamperedHead((head) => {
			head.envelope = other.head!.envelope;
			head.signature = other.head!.signature;
		}, 'signature_invalid');
	});

	it('refuses a valid head assigned to a different listing item', async () => {
		const item = await account.server.putItem(account.keyring, account.pouchId, 'pdf', 'v1');
		item.id = crypto.randomUUID();
		const result = await contents();
		expect(result.ingredients).toEqual([]);
		expect(result.unreadable[0]?.id).toBe(item.id);
		await expectReport('envelope_mismatch', account.pouchId);
	});

	it('refuses a revision whose artifact column was changed', async () => {
		await tamperedHead((head) => {
			head.artifact_id = crypto.randomUUID();
		}, 'aead_failure');
	});

	it('refuses a re-parented revision', async () => {
		await tamperedHead((head) => {
			head.parent_id = crypto.randomUUID();
		}, 'envelope_mismatch');
	});

	it('refuses a revision claimed by a member that does not exist', async () => {
		await tamperedHead((head) => {
			head.signer_member_id = crypto.randomUUID();
		}, 'signature_invalid');
	});

	it('refuses a revision signed by a stranger', async () => {
		const stranger = await generateMemberKeyPair();
		await tamperedHead((head) => resign(head, stranger), 'signature_invalid');
	});

	it('refuses a revision of another pouch replayed into this one', async () => {
		await tamperedHead(async (head) => {
			head.signature = await sign(
				account.browserKeys.signKey,
				REVISION_SIG_CONTEXT,
				concat(crypto.randomUUID(), head.id, blake3Hash(unb64(head.envelope))),
			);
		}, 'signature_invalid');
	});

	it('refuses what a removed member wrote after its removal, and keeps what it wrote before', async () => {
		const gone = await addMember(account, 'device');
		const goneKeyring = await openKeyring(
			{ id: gone.id, kind: 'device', keys: gone.keys },
			account.keyring.roster,
			account.server.envelopes,
		);
		const before = await account.server.putItem(goneKeyring, account.pouchId, 'old', 'old\n');
		await removeMember(account, gone.id);
		// Still holding generation 1, it claims to have seen the newest roster.
		const after = await account.server.putItem(
			goneKeyring,
			account.pouchId,
			'evil',
			'curl | sh\n',
			{
				rosterHead: account.server.head.hash!,
			},
		);
		const result = await contents();
		expect(result.ingredients.map((i) => i.id)).toEqual([before.id]);
		expect(result.unreadable.map((u) => u.id)).toEqual([after.id]);
		await expectReport('signature_invalid', account.pouchId);
	});
});

describe('older versions and missing items', () => {
	async function contents(browser?: StoredBrowserKey) {
		const keyring = await openAsBrowser(browser ?? (await thisBrowser()));
		return loadPouchContents(keyring, account.pouchId);
	}
	const names = (result: Awaited<ReturnType<typeof contents>>) =>
		result.ingredients.map((i) => `${i.name}${i.deleted ? ' (deleted)' : ''}`);
	const edit = (
		artifact: ServedArtifact,
		text: string,
		options?: Parameters<HonestAccount['server']['editItem']>[5],
	) => account.server.editItem(account.keyring, account.pouchId, artifact, 'pdf', text, options);

	it('bounds remembered ancestors without accepting an evicted replay or a merge-only fork', () => {
		const heads: Record<string, SeenHead> = {};
		for (let index = 0; index <= 70; index++) {
			const head = {
				artifactId: 'item',
				revisionId: `r${index}`,
				parents: [index ? `r${index - 1}` : null, null],
			};
			expect(classify(heads.item, head)).toBeNull();
			remember(heads, head);
		}
		expect(heads.item!.older.length).toBeLessThanOrEqual(64);
		expect(
			classify(heads.item, { artifactId: 'item', revisionId: 'r0', parents: [null, null] }),
		).toBe('unknown');
		expect(
			classify(heads.item, {
				artifactId: 'item',
				revisionId: 'fork',
				parents: ['r1', 'r70'],
			}),
		).toBe('unknown');
	});
	function acceptOperations(
		onOperation?: (operation: {
			artifact_id: string;
			revision_id: string;
			envelope: string;
			signature: string;
			key_gen: number;
		}) => void,
	) {
		const serverFetch = account.server.fetch;
		vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
			if (new URL(String(input), 'http://localhost').pathname.endsWith('/operations')) {
				const operation = JSON.parse(String(init?.body)).ops[0] as {
					artifact_id: string;
					revision_id: string;
					envelope: string;
					signature: string;
					key_gen: number;
				};
				onOperation?.(operation);
				return new Response(
					JSON.stringify({
						ok: true,
						data: {
							results: [
								{
									status: 'applied',
									artifact_id: operation.artifact_id,
									revision_id: operation.revision_id,
									seq: 2,
								},
							],
						},
					}),
					{ headers: { 'content-type': 'application/json' } },
				);
			}
			return serverFetch(input, init);
		});
	}

	it('does not turn a signed live revision into a deletion from unsigned listing metadata', async () => {
		const pdf = await account.server.putItem(account.keyring, account.pouchId, 'pdf', 'v1');
		await contents();
		pdf.deleted_at = '2026-10-11T00:00:00.000Z';
		// Hidden, as the API hides a name collision, but still live and pinned.
		expect(names(await contents())).toEqual([]);
		const keyring = await openAsBrowser(await thisBrowser());
		const all = await loadPouchContents(keyring, account.pouchId, true);
		expect(names(all)).toEqual(['pdf']);
		expect(all.unreadable).toEqual([]);
		expect(account.server.reports).toEqual([]);
	});

	it('verifies signed skipped ancestry and then refuses an intervening older revision', async () => {
		const pdf = await account.server.putItem(account.keyring, account.pouchId, 'pdf', 'v1');
		const r1 = pdf.head!;
		await contents();
		await edit(pdf, 'v2');
		const r2 = pdf.head!;
		await edit(pdf, 'v3');
		await edit(pdf, 'v4');
		expect(names(await contents())).toEqual(['pdf']);
		pdf.head = r2;
		expect(names(await contents())).toEqual([]);
		pdf.head = r1;
		expect(names(await contents())).toEqual([]);
		await expectReport('revision_rollback', account.pouchId);
	});

	it('does not demote r4 when a fresh browser first sees r4, then is offered r2', async () => {
		const pdf = await account.server.putItem(account.keyring, account.pouchId, 'pdf', 'v1');
		await edit(pdf, 'v2');
		const r2 = pdf.head!;
		await edit(pdf, 'v3');
		await edit(pdf, 'v4');
		const r4 = pdf.head!;
		expect(names(await contents())).toEqual(['pdf']);
		pdf.head = r2;
		const unknown = await contents();
		expect(unknown.ingredients).toEqual([]);
		expect(unknown.unreadable[0]?.reason).toMatch(/Cannot verify/);
		pdf.head = r4;
		expect(names(await contents())).toEqual(['pdf']);
	});

	it('keeps an item read-only when signed intermediate history is unavailable or pruned', async () => {
		const pdf = await account.server.putItem(account.keyring, account.pouchId, 'pdf', 'v1');
		await contents();
		await edit(pdf, 'v2');
		const r2 = pdf.head!;
		await edit(pdf, 'v3');
		account.server.revisions.delete(r2.id);
		const missing = await contents();
		expect(missing.ingredients).toEqual([]);
		expect(missing.unreadable[0]?.reason).toMatch(/Cannot verify/);
		account.server.revisions.set(r2.id, { ...r2, parent_id: null });
		expect(names(await contents())).toEqual(['pdf']);
		pdf.head = r2;
		expect((await contents()).ingredients).toEqual([]);
	});

	it('does not use an intermediate revision signed for another artifact as ancestry', async () => {
		const pdf = await account.server.putItem(account.keyring, account.pouchId, 'pdf', 'v1');
		await contents();
		await edit(pdf, 'v2');
		const r2 = pdf.head!;
		await edit(pdf, 'v3');
		const other = await account.server.putItem(account.keyring, account.pouchId, 'other', 'x');
		account.server.revisions.set(r2.id, { ...other.head!, id: r2.id });
		const result = await contents();
		expect(result.ingredients.map((item) => item.id)).toEqual([other.id]);
		expect(result.unreadable.map((item) => item.id)).toEqual([pdf.id]);
	});

	it('verifies skipped tombstone and restore ancestry, including a merge parent', async () => {
		const pdf = await account.server.putItem(account.keyring, account.pouchId, 'pdf', 'v1');
		await contents();
		await edit(pdf, 'v2', { deleted: true });
		const tombstone = pdf.head!;
		await edit(pdf, 'restored');
		await edit(pdf, 'merged', { mergeParentId: tombstone.id });
		const result = await contents();
		expect(result.unreadable).toEqual([]);
		expect(names(result)).toEqual(['pdf']);
		pdf.head = tombstone;
		expect((await contents()).ingredients).toEqual([]);
	});

	it('lists deleted items in the trash until their files are removed', async () => {
		const pdf = await account.server.putItem(account.keyring, account.pouchId, 'pdf', 'v1');
		const live = await account.server.putItem(account.keyring, account.pouchId, 'live', 'x');
		await contents();
		await edit(pdf, 'v1', { deleted: true });
		const result = await contents();
		expect(names(result)).toEqual(['live']);
		expect(result.trash.map((item) => [item.name, item.deletedAt])).toEqual([
			['pdf', pdf.deleted_at],
		]);
		expect(result.trash[0]?.filesRemoved).toBe(false);
		expect(result.trash.some((item) => item.id === live.id)).toBe(false);
		// "Delete permanently" or 7 days later: the signed delete stays, its files don't.
		pdf.head = { ...pdf.head!, blob_ids: [] };
		expect((await contents()).trash).toEqual([]);
	});

	it('rejects duplicate listing identities across pages in either order before any pin advances', async () => {
		const pdf = await account.server.putItem(account.keyring, account.pouchId, 'pdf', 'v1');
		const r1 = pdf.head!;
		await contents();
		await edit(pdf, 'v2');
		const r2 = pdf.head!;
		const serverFetch = account.server.fetch;
		for (const pair of [
			[r1, r2],
			[r2, r1],
		]) {
			vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
				const url = new URL(String(input), 'http://localhost');
				if (url.pathname.endsWith('/artifacts')) {
					const second = url.searchParams.has('cursor');
					return new Response(
						JSON.stringify({
							ok: true,
							data: { items: [{ ...pdf, head: pair[second ? 1 : 0] }] },
							meta: { next_cursor: second ? null : 'next' },
						}),
						{ headers: { 'content-type': 'application/json' } },
					);
				}
				return serverFetch(input, init);
			});
			await expect(contents()).rejects.toMatchObject({ kind: 'envelope_mismatch' });
		}
		vi.stubGlobal('fetch', serverFetch);
		pdf.head = r1;
		expect(names(await contents())).toEqual(['pdf']);
		pdf.head = r2;
		expect(names(await contents())).toEqual(['pdf']);
	});

	it('does not promote a signed fork of a pinned revision', async () => {
		const pdf = await account.server.putItem(account.keyring, account.pouchId, 'pdf', 'v1');
		const r1 = pdf.head!;
		await contents();
		await edit(pdf, 'v2');
		await contents();
		pdf.head = r1;
		await edit(pdf, 'fork');
		const result = await contents();
		expect(result.ingredients).toEqual([]);
		expect(result.unreadable[0]?.reason).toMatch(/Cannot verify/);
	});

	it('rejects a conflict record claiming a stale current mutation base', async () => {
		const pdf = await account.server.putItem(account.keyring, account.pouchId, 'pdf', 'v1');
		const r1 = pdf.head!.id;
		await contents();
		await edit(pdf, 'v2');
		await contents();
		setSession({
			status: 'unlocked',
			keyring: account.keyring,
			me: {} as never,
			browser: {} as never,
		});
		await expect(
			loadConflictVersions(account.pouchId, {
				id: crypto.randomUUID(),
				artifact_id: pdf.id,
				type: 'update_update',
				base_revision_id: r1,
				server_revision_id: r1,
				incoming_revision_id: null,
				head_revision_id: r1,
				device_id: null,
				state: 'open',
				created_at: '2026-10-10T00:00:00Z',
			}),
		).rejects.toThrow('Cannot verify the current version');
	});

	it('rejects historical conflict sides from another signed item, live or tombstoned', async () => {
		const a = await account.server.putItem(account.keyring, account.pouchId, 'a', 'a');
		const b = await account.server.putItem(account.keyring, account.pouchId, 'b', 'b');
		setSession({
			status: 'unlocked',
			keyring: account.keyring,
			me: {} as never,
			browser: {} as never,
		});
		for (const deleted of [false, true]) {
			if (deleted)
				await account.server.editItem(account.keyring, account.pouchId, b, 'b', 'gone', {
					deleted: true,
				});
			for (const side of ['server_revision_id', 'incoming_revision_id'] as const) {
				const conflict = {
					id: crypto.randomUUID(),
					artifact_id: a.id,
					type: 'update_update' as const,
					base_revision_id: a.head!.id,
					server_revision_id: a.head!.id,
					incoming_revision_id: null as string | null,
					head_revision_id: a.head!.id,
					device_id: null,
					state: 'open' as const,
					created_at: '2026-10-10T00:00:00Z',
				};
				conflict[side] = b.head!.id;
				await expect(loadConflictVersions(account.pouchId, conflict)).rejects.toMatchObject(
					{ kind: 'envelope_mismatch' },
				);
			}
		}
	});

	it('rejects a same-item pouch side that forks instead of preceding the verified head', async () => {
		const a = await account.server.putItem(account.keyring, account.pouchId, 'a', 'v1');
		const r1 = a.head!;
		await contents();
		await account.server.editItem(account.keyring, account.pouchId, a, 'a', 'v2');
		const r2 = a.head!;
		a.head = r1;
		await account.server.editItem(account.keyring, account.pouchId, a, 'a', 'fork');
		const fork = a.head!;
		a.head = r2;
		setSession({
			status: 'unlocked',
			keyring: account.keyring,
			me: {} as never,
			browser: {} as never,
		});
		await expect(
			loadConflictVersions(account.pouchId, {
				id: crypto.randomUUID(),
				artifact_id: a.id,
				type: 'update_update',
				base_revision_id: r1.id,
				server_revision_id: fork.id,
				incoming_revision_id: null,
				head_revision_id: r2.id,
				device_id: null,
				state: 'open',
				created_at: '2026-10-10T00:00:00Z',
			}),
		).rejects.toThrow(/not in the verified item history/);
	});

	it('verifies a hidden collision head without treating its unsigned hidden flag as a signed deletion', async () => {
		const holder = await account.server.putItem(
			account.keyring,
			account.pouchId,
			'pdf',
			'held',
		);
		const waiting = await account.server.putItem(
			account.keyring,
			account.pouchId,
			'pdf',
			'waiting',
		);
		waiting.deleted_at = '2026-10-10T00:00:00Z';
		const serverFetch = account.server.fetch;
		vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
			const url = new URL(String(input), 'http://localhost');
			if (url.pathname.endsWith('/artifacts')) {
				return new Response(
					JSON.stringify({
						ok: true,
						data: {
							items: account.server.artifacts.filter(
								(item) =>
									url.searchParams.get('include_deleted') === 'true' ||
									!item.deleted_at,
							),
						},
						meta: { next_cursor: null },
					}),
					{ headers: { 'content-type': 'application/json' } },
				);
			}
			if (url.pathname.endsWith('/revisions')) {
				return new Response(
					JSON.stringify({
						ok: true,
						data: {
							revisions: [holder.head, waiting.head],
						},
					}),
					{ headers: { 'content-type': 'application/json' } },
				);
			}
			return serverFetch(input, init);
		});
		setSession({
			status: 'unlocked',
			keyring: account.keyring,
			me: {} as never,
			browser: {} as never,
		});
		const versions = await loadConflictVersions(account.pouchId, {
			id: crypto.randomUUID(),
			artifact_id: waiting.id,
			type: 'name_collision',
			base_revision_id: null,
			server_revision_id: null,
			incoming_revision_id: null,
			head_revision_id: waiting.head!.id,
			device_id: null,
			state: 'open',
			created_at: '2026-10-10T00:00:00Z',
		});
		expect(versions.head.id).toBe(waiting.id);
		expect(versions.head.deleted).toBe(false);
		expect(versions.holder?.id).toBe(holder.id);
	});

	it('pins a successful local write before returning, rejecting an immediate replay', async () => {
		const pdf = await account.server.putItem(account.keyring, account.pouchId, 'pdf', 'v1');
		const before = (await contents()).ingredients[0]!;
		acceptOperations();
		const committed = await commitIngredient({
			keyring: account.keyring,
			pouch: { id: account.pouchId, epoch: '1' },
			type: 'update',
			artifactId: pdf.id,
			base: before,
			kind: before.kind,
			name: before.name,
			previousEntries: before.files,
		});
		expect(committed.revisionId).not.toBe(before.revisionId);
		const result = await contents();
		expect(result.ingredients).toEqual([]);
		await expectReport('revision_rollback', account.pouchId);
	});

	it('does not report an applied write as failed when recording it locally fails', async () => {
		const pdf = await account.server.putItem(account.keyring, account.pouchId, 'pdf', 'v1');
		const before = (await contents()).ingredients[0]!;
		let written!: { revision_id: string; envelope: string; signature: string; key_gen: number };
		acceptOperations((operation) => {
			written = operation;
		});
		const originalPut = IDBObjectStore.prototype.put;
		let calls = 0;
		const put = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (
			this: IDBObjectStore,
			...args
		) {
			calls++;
			if (calls === 2) throw new DOMException('quota exhausted', 'QuotaExceededError');
			return originalPut.apply(this, args);
		});
		try {
			const result = await commitIngredient({
				keyring: account.keyring,
				pouch: { id: account.pouchId, epoch: '1' },
				type: 'update',
				artifactId: pdf.id,
				base: before,
				kind: before.kind,
				name: before.name,
				previousEntries: before.files,
			});
			expect(result.revisionId).not.toBe(before.revisionId);
		} finally {
			put.mockRestore();
		}
		expect(names(await contents())).toEqual(['pdf']);
		pdf.head = {
			...pdf.head!,
			id: written.revision_id,
			parent_id: before.revisionId,
			envelope: written.envelope,
			signature: written.signature,
			key_gen: written.key_gen,
		};
		expect(names(await contents())).toEqual(['pdf']);
	});

	it('preflights an editor base after another tab advanced its pin; sends no operation', async () => {
		const pdf = await account.server.putItem(account.keyring, account.pouchId, 'pdf', 'v1');
		const before = (await contents()).ingredients[0]!;
		await edit(pdf, 'v2');
		await contents();
		await expect(
			commitIngredient({
				keyring: account.keyring,
				pouch: { id: account.pouchId, epoch: '1' },
				type: 'delete',
				artifactId: pdf.id,
				base: before,
				kind: before.kind,
				name: before.name,
				previousEntries: before.files,
			}),
		).rejects.toThrow(/changed since this editor opened/);
		expect(
			account.server.requests.filter((request) => request.endsWith('/operations')),
		).toEqual([]);
	});

	it('serializes same-artifact writes before network, and releases a failed one', async () => {
		const pdf = await account.server.putItem(account.keyring, account.pouchId, 'pdf', 'v1');
		const before = (await contents()).ingredients[0]!;
		let arrive!: () => void;
		let finish!: () => void;
		const arrived = new Promise<void>((resolve) => {
			arrive = resolve;
		});
		const release = new Promise<void>((resolve) => {
			finish = resolve;
		});
		const serverFetch = account.server.fetch;
		let operations = 0;
		vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
			if (new URL(String(input), 'http://localhost').pathname.endsWith('/operations')) {
				operations++;
				arrive();
				await release;
				throw new Error('response lost after submission');
			}
			return serverFetch(input, init);
		});
		const input = {
			keyring: account.keyring,
			pouch: { id: account.pouchId, epoch: '1' },
			type: 'update' as const,
			artifactId: pdf.id,
			base: before,
			kind: before.kind,
			name: before.name,
			previousEntries: before.files,
		};
		const first = commitIngredient(input);
		await arrived;
		await expect(commitIngredient(input)).rejects.toThrow(/changed since this editor opened/);
		expect(operations).toBe(1);
		finish();
		await expect(first).rejects.toThrow(/Check your connection/);
		vi.stubGlobal('fetch', serverFetch);
		// A failed save leaves the item visible and editable from the same base.
		expect(names(await contents())).toEqual(['pdf']);
		acceptOperations();
		await expect(commitIngredient(input)).resolves.toHaveProperty('revisionId');
	});

	it('fails closed if durable head storage is unavailable', async () => {
		const pdf = await account.server.putItem(account.keyring, account.pouchId, 'pdf', 'v1');
		acceptOperations();
		const storage = indexedDB;
		vi.stubGlobal('indexedDB', {
			open: () => {
				throw new Error('storage unavailable');
			},
		});
		await expect(contents()).rejects.toThrow('storage unavailable');
		await expect(
			commitIngredient({
				keyring: account.keyring,
				pouch: { id: account.pouchId, epoch: '1' },
				type: 'update',
				artifactId: pdf.id,
				base: { revisionId: pdf.head!.id },
				kind: 'skill',
				name: 'pdf',
				previousEntries: [],
			}),
		).rejects.toThrow('storage unavailable');
		expect(
			account.server.requests.filter((request) => request.endsWith('/operations')),
		).toEqual([]);
		vi.stubGlobal('indexedDB', storage);
	});

	it('rejects a listing when persisting its head exceeds storage quota', async () => {
		await account.server.putItem(account.keyring, account.pouchId, 'pdf', 'v1');
		const put = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(() => {
			throw new DOMException('quota exhausted', 'QuotaExceededError');
		});
		try {
			await expect(contents()).rejects.toMatchObject({ name: 'QuotaExceededError' });
		} finally {
			put.mockRestore();
		}
		expect(names(await contents())).toEqual(['pdf']);
	});

	it('rejects malformed persisted head state and aborts without overwriting it', async () => {
		const pdf = await account.server.putItem(account.keyring, account.pouchId, 'pdf', 'v1');
		const id = `${account.keyring.member.id}/${account.pouchId}`;
		const db = await new Promise<IDBDatabase>((resolve, reject) => {
			const request = indexedDB.open('skillpouch-heads', 1);
			request.onsuccess = () => resolve(request.result);
			request.onerror = () => reject(request.error);
		});
		try {
			await new Promise<void>((resolve, reject) => {
				const tx = db.transaction('pouches', 'readwrite');
				tx.objectStore('pouches').put({ id, heads: { [pdf.id]: null } });
				tx.oncomplete = () => resolve();
				tx.onerror = () => reject(tx.error);
			});
			await expect(contents()).rejects.toThrow(/head history is corrupt/);
			await expect(
				commitIngredient({
					keyring: account.keyring,
					pouch: { id: account.pouchId, epoch: '1' },
					type: 'update',
					artifactId: pdf.id,
					base: { revisionId: pdf.head!.id },
					kind: 'skill',
					name: 'pdf',
					previousEntries: [],
				}),
			).rejects.toThrow(/head history is corrupt/);
			const stored = await new Promise<unknown>((resolve, reject) => {
				const tx = db.transaction('pouches');
				const request = tx.objectStore('pouches').get(id);
				request.onsuccess = () => resolve(request.result);
				request.onerror = () => reject(request.error);
			});
			expect((stored as { heads: Record<string, unknown> }).heads[pdf.id]).toBeNull();
			expect(
				account.server.requests.filter((request) => request.endsWith('/operations')),
			).toEqual([]);
		} finally {
			db.close();
		}
	});

	it('follows honest history: edits, a deliberate restore, a merge, a new browser', async () => {
		const pdf = await account.server.putItem(account.keyring, account.pouchId, 'pdf', 'v1');
		await contents();
		const v1 = await edit(pdf, 'v2');
		await contents();
		// Restoring version 1 on purpose writes a new revision with the old files.
		await edit(pdf, 'v1');
		expect((await contents()).ingredients[0]!.revisionId).toBe(pdf.head!.id);
		await edit(pdf, 'merged', { mergeParentId: v1.id });
		const merged = await contents();
		expect(merged.unreadable).toEqual([]);
		expect(merged.ingredients[0]!.revisionId).toBe(pdf.head!.id);

		const other = await addMember(account, 'browser');
		const fresh = await storedBrowser(other.keys, other.id);
		const elsewhere = await openAsBrowser(fresh);
		expect((await loadPouchContents(elsewhere, account.pouchId)).unreadable).toEqual([]);
		expect(account.server.reports).toEqual([]);
	});

	it('refuses (and reports) an older head replayed in place of the newer one it saw', async () => {
		const pdf = await account.server.putItem(account.keyring, account.pouchId, 'pdf', 'v1');
		await account.server.putItem(account.keyring, account.pouchId, 'ok', 'fine');
		await contents();
		const v1 = await edit(pdf, 'v2');
		await contents();

		pdf.head = v1;
		const result = await contents();
		expect(names(result)).toEqual(['ok']);
		expect(result.unreadable.map((u) => u.id)).toEqual([pdf.id]);
		await expectReport('revision_rollback', account.pouchId);
	});

	it('refuses the old live head of an item it saw deleted', async () => {
		const pdf = await account.server.putItem(account.keyring, account.pouchId, 'pdf', 'v1');
		await contents();
		const live = await edit(pdf, 'v1', { deleted: true });
		expect(names(await contents())).toEqual([]);

		pdf.head = live;
		pdf.deleted_at = null;
		const result = await contents();
		expect(names(result)).toEqual([]);
		await expectReport('revision_rollback', account.pouchId);
	});

	it('an item the listing left out may come back as it was, but not older', async () => {
		const pdf = await account.server.putItem(account.keyring, account.pouchId, 'pdf', 'v1');
		const v1 = await edit(pdf, 'v2');
		await contents();
		account.server.artifacts = [];
		expect(names(await contents())).toEqual([]);

		account.server.artifacts = [pdf];
		expect(names(await contents())).toEqual(['pdf']);
		account.server.artifacts = [{ ...pdf, head: v1 }];
		expect(names(await contents())).toEqual([]);
		await expectReport('revision_rollback', account.pouchId);
	});

	it('reads a freed deleted item whose pruned parent link is empty', async () => {
		const pdf = await account.server.putItem(account.keyring, account.pouchId, 'pdf', 'v1');
		await edit(pdf, 'v1', { deleted: true });
		pdf.head = { ...pdf.head!, parent_id: null, blob_ids: [] };
		const keyring = await openAsBrowser(await thisBrowser());
		const result = await loadPouchContents(keyring, account.pouchId, true);
		expect(names(result)).toEqual(['pdf (deleted)']);
		expect(result.unreadable).toEqual([]);
	});
});

describe('blobs', () => {
	async function files(edit: (blobs: Map<string, Uint8Array>, ids: string[]) => void) {
		const a = await account.server.putItem(account.keyring, account.pouchId, 'a', 'first\n');
		const b = await account.server.putItem(account.keyring, account.pouchId, 'b', 'second\n');
		const ids = [a.head!.blob_ids[0]!, b.head!.blob_ids[0]!];
		edit(account.server.blobs, ids);
		const keyring = await openAsBrowser(await thisBrowser());
		return fetchBlobs(keyring, account.pouchId, ids);
	}

	it('refuses a bit-flipped blob', async () => {
		await refusedAndReported(
			files((blobs, [id]) => {
				const stored = blobs.get(id!)!;
				stored[stored.length - 1]! ^= 0x01;
			}),
			'aead_failure',
			account.pouchId,
		);
	});

	it('refuses blobs served under each other’s ids', async () => {
		await refusedAndReported(
			files((blobs, [a, b]) => {
				const first = blobs.get(a!)!;
				blobs.set(a!, blobs.get(b!)!);
				blobs.set(b!, first);
			}),
			'aead_failure',
			account.pouchId,
		);
	});

	it('refuses content that does not match its keyed id', async () => {
		await refusedAndReported(
			files((blobs, [id]) => {
				// Sealed with the pouch key under the id of other content.
				const keys = pouchKeys(account.keyring, account.pouchId);
				const aad = concat('skillpouch/v1/blob', account.pouchId, unb64(id!));
				blobs.set(
					id!,
					seal(
						keys.current.content,
						keys.current.keyGen,
						new TextEncoder().encode('rm -rf ~\n'),
						aad,
					),
				);
			}),
			'blob_id_mismatch',
			account.pouchId,
		);
	});

	it('refuses another account’s blob', async () => {
		const other = await honestAccount();
		const theirs = await other.server.putItem(other.keyring, other.pouchId, 'x', 'theirs\n');
		await refusedAndReported(
			files((blobs, [id]) => {
				blobs.set(id!, other.server.blobs.get(theirs.head!.blob_ids[0]!)!);
			}),
			'aead_failure',
			account.pouchId,
		);
	});
});

describe('unlocking with the Recovery Key', () => {
	async function newBrowser(): Promise<UnlockContext> {
		const browser = await storedBrowser(await generateMemberKeyPair(), null);
		return { accountId: account.accountId, browser, membership: 'none' };
	}

	it('takes the member and its salt from the signed roster, not the server’s unlock parameters', async () => {
		const passwordId = [...account.keyring.roster.members.values()].find(
			(m) => m.kind === 'password',
		)!.id;
		account.server.rewrite = (route, data) =>
			route === 'GET /v1/account/unlock/params'
				? {
						...(data as object),
						members: [
							{ id: passwordId, kind: 'recovery', member_salt: b64(newMemberSalt()) },
						],
					}
				: data;
		const keyring = await openWithSecret(await newBrowser(), 'recovery', account.recoveryWords);
		expect(keyring.member.kind).toBe('recovery');
		expect(pouchKeys(keyring, account.pouchId).current).toEqual(
			pouchKeys(account.keyring, account.pouchId).current,
		);
		expect(account.server.reports).toEqual([]);
	});

	it('refuses (and reports) when the newest key was withheld from the recovery member', async () => {
		const gone = await addMember(account, 'device');
		await removeMember(account, gone.id);
		const recoveryId = [...account.keyring.roster.members.values()].find(
			(m) => m.kind === 'recovery',
		)!.id;
		account.server.envelopes = account.server.envelopes.filter(
			(e) => !(e.member_id === recoveryId && e.key_gen === 2),
		);
		await refusedAndReported(
			openWithSecret(await newBrowser(), 'recovery', account.recoveryWords),
			'roster_rollback',
		);
	});
});

describe('unlocking with a passkey', () => {
	/** An authenticator whose PRF output depends on its secret and the input, like a real one. */
	function authenticator(secret: Uint8Array, credentialId: Uint8Array) {
		const get = vi.fn(
			async ({ publicKey }: { publicKey: PublicKeyCredentialRequestOptions }) => {
				const prf = (
					publicKey.extensions as {
						prf: { evalByCredential: Record<string, { first: ArrayBuffer }> };
					}
				).prf;
				const input = new Uint8Array(prf.evalByCredential[b64(credentialId)]!.first);
				const output = blake3Hash(concat(secret, input));
				const data = randomBytes(37).buffer;
				return {
					id: b64(credentialId),
					rawId: credentialId.slice().buffer,
					type: 'public-key',
					authenticatorAttachment: 'platform',
					response: {
						clientDataJSON: data,
						authenticatorData: data,
						signature: data,
						userHandle: null,
					},
					getClientExtensionResults: () => ({
						prf: { results: { first: output.slice().buffer } },
					}),
				};
			},
		);
		Object.defineProperty(navigator, 'credentials', { configurable: true, value: { get } });
		return get;
	}

	async function registerPasskey() {
		const secret = randomBytes(32);
		const credentialId = randomBytes(16);
		const salt = newMemberSalt();
		const keys = await passkeyMemberKeys(blake3Hash(concat(secret, prfInput(salt))), salt);
		const memberId = crypto.randomUUID();
		const { statement, key_envelopes } = await buildAddMember(
			account.keyring,
			memberEntry(memberId, 'passkey', keys, { memberSalt: b64(salt) }),
		);
		account.server.append([statement.input], key_envelopes);
		const record = {
			id: crypto.randomUUID(),
			member_id: memberId,
			credential_id: b64(credentialId),
			transports: ['internal'],
			label: 'MacBook',
			created_at: '2026-10-10T00:00:00.000Z',
			last_used_at: null,
		};
		account.server.passkeys.push(record);
		return { secret, credentialId, memberId, record, keys };
	}

	async function context(): Promise<UnlockContext> {
		const browser = await storedBrowser(await generateMemberKeyPair(), null);
		return { accountId: account.accountId, browser, membership: 'none' };
	}

	const asserted = () => account.server.requests.includes('POST /v1/account/passkeys/assert');

	it('opens the pouch keys with an honest server', async () => {
		const passkey = await registerPasskey();
		authenticator(passkey.secret, passkey.credentialId);
		const keyring = await openWithPasskey(await context());
		expect(keyring.member).toMatchObject({ id: passkey.memberId, kind: 'passkey' });
		expect(asserted()).toBe(true);
	});

	it('ignores a passkey the server lists for a member that is not in the roster', async () => {
		const passkey = await registerPasskey();
		const get = authenticator(passkey.secret, passkey.credentialId);
		account.server.passkeys = [{ ...passkey.record, member_id: crypto.randomUUID() }];
		await expect(openWithPasskey(await context())).rejects.toBeInstanceOf(PasskeyError);
		expect(get).not.toHaveBeenCalled();
		expect(asserted()).toBe(false);
	});

	it('refuses a passkey member injected into the roster without a member’s signature', async () => {
		const forger = await generateMemberKeyPair();
		const salt = newMemberSalt();
		account.server.statements.push(
			await account.server.forge(
				account.accountId,
				{ id: account.keyring.member.id, signKey: forger.signKey },
				{
					action: 'add',
					member: memberEntry(crypto.randomUUID(), 'passkey', forger, {
						memberSalt: b64(salt),
					}),
				},
			),
		);
		await refusedAndReported(openWithPasskey(await context()), 'signature_invalid');
		expect(asserted()).toBe(false);
	});

	it('a credential mapped to another passkey member (the wrong salt) derives a key the roster refuses', async () => {
		const mine = await registerPasskey();
		const theirs = await registerPasskey();
		authenticator(mine.secret, mine.credentialId);
		account.server.passkeys = [{ ...mine.record, member_id: theirs.memberId }];
		await expect(openWithPasskey(await context())).rejects.toMatchObject({
			kind: 'wrong_secret',
		});
		expect(asserted()).toBe(false);
		expect(account.server.reports).toEqual([]);
	});

	it('refuses (and reports) a substituted key envelope for the passkey member', async () => {
		const passkey = await registerPasskey();
		authenticator(passkey.secret, passkey.credentialId);
		const stranger = await generateMemberKeyPair();
		const forged = await sealKeyEnvelope(
			{ id: crypto.randomUUID(), signKey: stranger.signKey },
			{ id: passkey.memberId, encPub: passkey.keys.encPub },
			account.pouchId,
			1,
			{ ...material(), ps: randomBytes(32) },
		);
		account.server.envelopes = account.server.envelopes
			.filter((e) => e.member_id !== passkey.memberId)
			.concat(forged);
		await refusedAndReported(openWithPasskey(await context()), 'signature_invalid');
	});
});
