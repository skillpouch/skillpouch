// SPDX-License-Identifier: AGPL-3.0-only
import { z } from 'zod';
import { Limits } from '../limits';
import {
	B64Url,
	Hash32,
	KeyStorage,
	P256PublicJwk,
	Timestamp,
	Uuid,
	b64urlBytes,
	b64urlMax,
} from './common';

/**
 * Account roster (15 §7). Statements are signed canonical JSON. The API stores
 * them verbatim and performs only *structural* checks: chain links, sizes,
 * signer is an active member, effects on membership/pouch tables. Clients are
 * the ones that decide trust.
 */
export const MemberKind = z.enum(['password', 'browser', 'device', 'recovery', 'passkey']);
export type MemberKind = z.infer<typeof MemberKind>;

/** Member kinds whose keys are derived from a secret (15 §4) and carry a `member_salt`. */
export const SECRET_MEMBER_KINDS: readonly MemberKind[] = ['password', 'recovery', 'passkey'];

export const RosterMember = z.object({
	id: Uuid,
	kind: MemberKind,
	sign_pub: P256PublicJwk,
	enc_pub: P256PublicJwk,
	label_enc: b64urlMax(1024).optional(),
	key_storage: KeyStorage.optional(),
	/** HKDF salt of secret-derived members (16 random bytes). */
	member_salt: b64urlBytes(16).optional(),
});
export type RosterMember = z.infer<typeof RosterMember>;

export const RosterAction = z.enum([
	'genesis',
	'add',
	'remove',
	'rotate_keys',
	'create_pouch',
	'rename_pouch',
	'archive_pouch',
]);
export type RosterAction = z.infer<typeof RosterAction>;

/** The plaintext statement body, parsed by the API from the signed bytes. */
export const RosterStatementBody = z.object({
	format: z.literal(1),
	account_id: Uuid,
	seq: z.number().int().min(0),
	prev_hash: Hash32.nullable(),
	action: RosterAction,
	members: z.array(RosterMember).min(1).max(8).optional(),
	member: RosterMember.optional(),
	member_id: Uuid.optional(),
	pouch: z.object({ id: Uuid, name_enc: b64urlMax(1024).optional() }).optional(),
	new_generations: z.record(z.string(), z.number().int().min(1)).optional(),
	created_at: Timestamp,
	signer_member_id: Uuid,
});
export type RosterStatementBody = z.infer<typeof RosterStatementBody>;

/** A statement as sent to / returned by the API. */
export const RosterStatementInput = z.strictObject({
	/** base64url of the canonical JSON bytes that were signed. */
	statement: b64urlMax(Limits.rosterStatementMaxBytes),
	signature: b64urlMax(256),
});
export type RosterStatementInput = z.infer<typeof RosterStatementInput>;

export const KeyEnvelopeInput = z.strictObject({
	pouch_id: Uuid,
	member_id: Uuid,
	key_gen: z.number().int().min(1),
	hpke_enc: b64urlMax(256),
	ciphertext: b64urlMax(Limits.keyEnvelopeMaxBytes),
	created_by_member: Uuid,
	signature: b64urlMax(256),
});
export type KeyEnvelopeInput = z.infer<typeof KeyEnvelopeInput>;

export const KeyEnvelope = KeyEnvelopeInput.extend({ created_at: Timestamp });

export const RosterAppendRequest = z.strictObject({
	statements: z.array(RosterStatementInput).min(1).max(16),
	key_envelopes: z.array(KeyEnvelopeInput).max(2000).default([]),
});
export type RosterAppendRequest = z.infer<typeof RosterAppendRequest>;

export const RosterStatement = z.object({
	seq: z.number().int(),
	prev_hash: Hash32.nullable(),
	statement: B64Url,
	statement_hash: Hash32,
	signer_member_id: Uuid,
	signature: B64Url,
	pouch_id: Uuid.nullable(),
	created_at: Timestamp,
});

export const RosterResponse = z.object({
	genesis_hash: Hash32.nullable(),
	head_seq: z.number().int(),
	statements: z.array(RosterStatement),
});

export const GenesisRequest = z.strictObject({
	/** #0 `genesis` (browser + password + recovery members) and #1 `create_pouch`. */
	statements: z.array(RosterStatementInput).length(2),
	key_envelopes: z.array(KeyEnvelopeInput).min(1).max(16),
});

export const Member = z.object({
	id: Uuid,
	kind: MemberKind,
	device_id: Uuid.nullable(),
	sign_pub: P256PublicJwk,
	enc_pub: P256PublicJwk,
	label_enc: B64Url.nullable(),
	member_salt: B64Url.nullable(),
	added_seq: z.number().int(),
	removed_seq: z.number().int().nullable(),
	revoked_at: Timestamp.nullable(),
	last_seen_at: Timestamp.nullable(),
	trust_expired_at: Timestamp.nullable(),
});
