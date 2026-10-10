// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A server that lies, for tests. It holds a real account built with
 * `@skillpouch/crypto` (genesis, members, key envelopes, sealed and signed
 * items) and answers the web client's requests through a `fetch` stand-in,
 * so the code under test runs its real API client. Tests tamper with what
 * it holds — statements, envelopes, revisions, blobs, unlock parameters —
 * or rewrite any JSON answer, and read back the security reports the
 * client sent.
 */
import {
	ClientSecurityReport,
	type KeyEnvelopeInput,
	type RosterMember,
	type RosterStatementInput,
} from '@skillpouch/contracts';
import {
	b64,
	blake3Hash,
	buildAddMember,
	buildGenesis,
	buildRemoveMember,
	generateMemberKeyPair,
	generateRecoveryKey,
	memberEntry,
	pouchKeys,
	randomBytes,
	sealBlob,
	sealRevision,
	signStatement,
	unb64,
	type Keyring,
	type MemberKeyPair,
	type RevisionBody,
	type RosterStatementWire,
	type StatementFields,
} from '@skillpouch/crypto';

export interface ServedRevision {
	id: string;
	artifact_id: string;
	parent_id: string | null;
	merge_parent_id: string | null;
	envelope: string;
	envelope_hash: string;
	signature: string;
	signer_member_id: string;
	key_gen: number;
	stored_size: number;
	origin: 'web';
	author_device_id: null;
	blob_ids: string[];
	created_at: string;
}

export interface ServedArtifact {
	id: string;
	name_index: string;
	deleted_at: string | null;
	updated_at: string;
	head: ServedRevision | null;
}

export interface ServedPasskey {
	id: string;
	member_id: string;
	credential_id: string;
	transports: string[];
	label: string | null;
	created_at: string;
	last_used_at: string | null;
}

const NOW = '2026-10-10T00:00:00.000Z';

const json = (status: number, body: unknown) =>
	new Response(JSON.stringify(body), {
		status,
		headers: { 'content-type': 'application/json' },
	});

const ok = (data: unknown) => json(200, { ok: true, data, meta: { next_cursor: null } });

export class EvilServer {
	statements: RosterStatementWire[] = [];
	envelopes: KeyEnvelopeInput[] = [];
	artifacts: ServedArtifact[] = [];
	blobs = new Map<string, Uint8Array>();
	passkeys: ServedPasskey[] = [];
	/** Security reports the client sent, as the API validated them. */
	reports: ReturnType<typeof ClientSecurityReport.parse>[] = [];
	/** `METHOD /path` of every request, in order. */
	requests: string[] = [];
	/** Last word on every JSON answer: return what the route should say instead. */
	rewrite: (route: string, data: unknown) => unknown = (_, data) => data;

	/** Stores statements and envelopes exactly as the API would. */
	append(inputs: RosterStatementInput[], envelopes: KeyEnvelopeInput[] = []): void {
		for (const input of inputs) this.statements.push(this.wire(input));
		this.envelopes.push(...envelopes);
	}

	wire(input: RosterStatementInput, seq = this.statements.length): RosterStatementWire {
		return {
			seq,
			statement: input.statement,
			statement_hash: b64(blake3Hash(unb64(input.statement))),
			signature: input.signature,
		};
	}

	get head(): { seq: number; hash: string | null } {
		const last = this.statements.at(-1);
		return { seq: last?.seq ?? -1, hash: last?.statement_hash ?? null };
	}

	/** Signs the next statement as anyone (the forger holds `signKey`). */
	async forge(
		accountId: string,
		signer: { id: string; signKey: CryptoKey },
		fields: StatementFields,
	): Promise<RosterStatementWire> {
		const signed = await signStatement(signer, accountId, this.head, fields, NOW);
		return this.wire(signed.input);
	}

	unlockMembers(): { id: string; kind: string; member_salt: string | null }[] {
		const removed = new Set<string>();
		const members: RosterMember[] = [];
		for (const wire of this.statements) {
			const body = JSON.parse(new TextDecoder().decode(unb64(wire.statement))) as {
				members?: RosterMember[];
				member?: RosterMember;
				member_id?: string;
			};
			members.push(...(body.members ?? []), ...(body.member ? [body.member] : []));
			if (body.member_id) removed.add(body.member_id);
		}
		return members
			.filter((m) => !removed.has(m.id) && m.member_salt)
			.map((m) => ({ id: m.id, kind: m.kind, member_salt: m.member_salt ?? null }));
	}

	private answer(route: string, data: unknown): Response {
		return ok(this.rewrite(route, data));
	}

	fetch = async (input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> => {
		const url = new URL(
			String(input instanceof Request ? input.url : input),
			'http://localhost',
		);
		const method = (init.method ?? 'GET').toUpperCase();
		const route = `${method} ${url.pathname.replace(/\/pouches\/[^/]+\//, '/pouches/:id/')}`;
		this.requests.push(`${method} ${url.pathname}`);
		const body = typeof init.body === 'string' ? (JSON.parse(init.body) as unknown) : null;
		switch (route) {
			case 'GET /v1/account/roster':
				return this.answer(route, {
					genesis_hash: this.statements[0]?.statement_hash ?? null,
					head_seq: this.head.seq,
					statements: this.statements,
				});
			case 'GET /v1/account/key-envelopes':
				return this.answer(route, { key_envelopes: this.envelopes });
			case 'GET /v1/account/unlock/envelopes': {
				const memberId = url.searchParams.get('member_id');
				return this.answer(route, {
					key_envelopes: this.envelopes.filter((e) => e.member_id === memberId),
				});
			}
			case 'GET /v1/account/unlock/params':
				return this.answer(route, {
					state: 'ready',
					kdf_salt: null,
					kdf_params: null,
					members: this.unlockMembers(),
					passkeys: this.passkeys,
					browser_trust_days: 30,
					failed_streak: 0,
				});
			case 'POST /v1/account/passkeys/assert-options':
				return this.answer(route, {
					options: {
						challenge: b64(randomBytes(32)),
						rpId: 'localhost',
						userVerification: 'required',
						allowCredentials: this.passkeys.map((p) => ({ id: p.credential_id })),
					},
				});
			case 'POST /v1/account/passkeys/assert':
			case 'POST /v1/account/unlock/failed':
				return this.answer(route, {});
			case 'GET /v1/pouches/:id/artifacts':
				return this.answer(route, { items: this.artifacts });
			case 'POST /v1/pouches/:id/blobs/fetch': {
				const ids = (body as { ids: string[] }).ids;
				const parts: number[] = [];
				for (const id of ids) {
					const stored = this.blobs.get(id);
					if (!stored) continue;
					const length = new Uint8Array(4);
					new DataView(length.buffer).setUint32(0, stored.length, false);
					parts.push(...unb64(id), ...length, ...stored);
				}
				return new Response(new Uint8Array(parts), {
					status: 200,
					headers: { 'content-type': 'application/octet-stream' },
				});
			}
			case 'POST /v1/security/reports':
				this.reports.push(ClientSecurityReport.parse(body));
				return ok({});
			default:
				return json(404, {
					ok: false,
					error: { code: 'not_found', message: route, retryable: false },
				});
		}
	};

	/** Seals and signs an item the way a member's client does, and stores it. */
	async putItem(
		keyring: Keyring,
		pouchId: string,
		name: string,
		text: string,
		options: { parentId?: string | null; rosterHead?: string } = {},
	): Promise<ServedArtifact> {
		const keys = pouchKeys(keyring, pouchId);
		const blob = sealBlob(keys, new TextEncoder().encode(text));
		const body: RevisionBody = {
			format: 1,
			artifact_id: crypto.randomUUID(),
			revision_id: crypto.randomUUID(),
			parent_id: options.parentId ?? null,
			merge_parent_id: null,
			kind: 'skill',
			scope: 'global',
			logical_key: name,
			deleted: false,
			entries: [{ path: 'SKILL.md', blob: blob.id, size: blob.size, mode: 'file' }],
			roster_head: options.rosterHead ?? keyring.roster.headHash,
			author_member_id: keyring.member.id,
			created_at: NOW,
		};
		const sealed = await sealRevision(keys, keyring.member.keys, body);
		const artifact: ServedArtifact = {
			id: body.artifact_id,
			name_index: b64(randomBytes(32)),
			deleted_at: null,
			updated_at: NOW,
			head: {
				id: body.revision_id,
				artifact_id: body.artifact_id,
				parent_id: body.parent_id,
				merge_parent_id: null,
				envelope: sealed.envelope,
				envelope_hash: b64(blake3Hash(unb64(sealed.envelope))),
				signature: sealed.signature,
				signer_member_id: keyring.member.id,
				key_gen: sealed.keyGen,
				stored_size: unb64(sealed.envelope).length,
				origin: 'web',
				author_device_id: null,
				blob_ids: [blob.id],
				created_at: NOW,
			},
		};
		this.blobs.set(blob.id, blob.bytes);
		this.artifacts.push(artifact);
		return artifact;
	}
}

export interface HonestAccount {
	server: EvilServer;
	accountId: string;
	pouchId: string;
	/** The browser that created the account, unlocked. */
	keyring: Keyring;
	browserKeys: MemberKeyPair;
	genesisHash: string;
	/** The 12 words of the account's Recovery Key. */
	recoveryWords: string;
}

/** A fresh account as web onboarding creates it, held by an honest server. */
export async function honestAccount(): Promise<HonestAccount> {
	const accountId = crypto.randomUUID();
	const pouchId = crypto.randomUUID();
	const browserKeys = await generateMemberKeyPair();
	const recovery = generateRecoveryKey();
	const genesis = await buildGenesis({
		accountId,
		browserMemberId: crypto.randomUUID(),
		browserKeys,
		passwordSecret: randomBytes(64),
		passwordMemberId: crypto.randomUUID(),
		recoveryEntropy: recovery.entropy,
		recoveryMemberId: crypto.randomUUID(),
		pouchId,
		pouch: { name: 'Personal', description: '' },
	});
	const server = new EvilServer();
	server.append(genesis.request.statements, genesis.request.key_envelopes);
	return {
		server,
		accountId,
		pouchId,
		keyring: genesis.keyring,
		browserKeys,
		genesisHash: genesis.genesisHash,
		recoveryWords: recovery.words.join(' '),
	};
}

/** Adds a member signed by `keyring`'s member; returns it with its keys. */
export async function addMember(
	account: HonestAccount,
	kind: RosterMember['kind'],
	extra: Parameters<typeof memberEntry>[3] = {},
): Promise<{ id: string; keys: MemberKeyPair }> {
	const keys = await generateMemberKeyPair();
	const id = crypto.randomUUID();
	const { statement, key_envelopes } = await buildAddMember(
		account.keyring,
		memberEntry(id, kind, keys, kind === 'device' ? { keyStorage: 'file', ...extra } : extra),
	);
	account.server.append([statement.input], key_envelopes);
	return { id, keys };
}

/** Removes a member and rotates every pouch, like the Devices page does. */
export async function removeMember(account: HonestAccount, memberId: string): Promise<void> {
	const change = await buildRemoveMember(account.keyring, memberId);
	account.server.append(change.statements, change.key_envelopes);
}

/** Flips one bit of a base64url value. */
export function flip(value: string, at = 10): string {
	const bytes = unb64(value);
	bytes[Math.min(at, bytes.length - 1)]! ^= 0x01;
	return b64(bytes);
}
