// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Client-side E2EE stand-ins for tests. The API never decrypts, so tests
 * only need *well-formed* ciphertext (correct header, random body) and real
 * signatures from real member keys — exactly what the server can check.
 */
import { randomBytes } from 'node:crypto';
import { blake3 } from '@noble/hashes/blake3.js';
import {
	canonicalJson,
	type KeyEnvelopeInput,
	type RosterStatementInput,
} from '@skillpouch/contracts';
import { uuidv7 } from '../../src/lib/ids';
import type { BaseClient } from './clients';
import { TestKey, type PublicJwk } from './keys';

export const b64 = (bytes: Uint8Array) => Buffer.from(bytes).toString('base64url');

export interface MemberHandle {
	id: string;
	kind: 'browser' | 'device' | 'recovery';
	key: TestKey;
	enc: TestKey;
}

export async function newMember(kind: MemberHandle['kind'], key?: TestKey): Promise<MemberHandle> {
	return {
		id: uuidv7(),
		kind,
		key: key ?? (await TestKey.generate()),
		enc: await TestKey.generate(),
	};
}

export function memberJson(member: MemberHandle): Record<string, unknown> {
	return {
		id: member.id,
		kind: member.kind,
		sign_pub: member.key.jwk,
		enc_pub: member.enc.jwk,
		...(member.kind === 'device' ? { key_storage: 'file' } : {}),
	};
}

export interface RosterHead {
	seq: number;
	hash: string | null;
}

/** Reads the current roster head from the API. */
export async function rosterHead(client: BaseClient): Promise<RosterHead> {
	const response = await client.get('/v1/account/roster?after=-1');
	const statements = response.body.data.statements as { seq: number; statement_hash: string }[];
	const last = statements.at(-1);
	return { seq: last?.seq ?? -1, hash: last?.statement_hash ?? null };
}

/** Builds and signs one roster statement on top of `head`; advances `head`. */
export async function statement(
	signer: MemberHandle,
	accountId: string,
	head: RosterHead,
	fields: Record<string, unknown>,
): Promise<RosterStatementInput> {
	const body = {
		format: 1,
		account_id: accountId,
		seq: head.seq + 1,
		prev_hash: head.hash,
		created_at: new Date().toISOString(),
		signer_member_id: signer.id,
		...fields,
	};
	const bytes = Buffer.from(canonicalJson(body));
	head.seq += 1;
	head.hash = b64(blake3(bytes));
	return {
		statement: b64(bytes),
		signature: await signer.key.sign('skillpouch/v1/roster', bytes),
	};
}

/** A well-formed sealed object (15 §5.1): 0x01 ‖ u32 gen ‖ nonce ‖ ciphertext ‖ tag. */
export function sealed(keyGen: number, plaintextBytes = 64): Buffer {
	const header = Buffer.alloc(5);
	header[0] = 0x01;
	header.writeUInt32BE(keyGen, 1);
	return Buffer.concat([header, randomBytes(24), randomBytes(plaintextBytes + 16)]);
}

export function keyEnvelope(
	pouchId: string,
	memberId: string,
	keyGen: number,
	createdBy: string,
): KeyEnvelopeInput {
	return {
		pouch_id: pouchId,
		member_id: memberId,
		key_gen: keyGen,
		hpke_enc: b64(randomBytes(65)),
		ciphertext: b64(randomBytes(80)),
		created_by_member: createdBy,
		signature: b64(randomBytes(64)),
	};
}

export function envelopesFor(
	pouchId: string,
	members: MemberHandle[],
	keyGen: number,
	createdBy: string,
) {
	return members.map((member) => keyEnvelope(pouchId, member.id, keyGen, createdBy));
}

export function randomBlobId(): string {
	return b64(randomBytes(32));
}

export type { PublicJwk };
