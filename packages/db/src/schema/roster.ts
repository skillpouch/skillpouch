// SPDX-License-Identifier: AGPL-3.0-only
/** E2EE membership: members, roster chain, key envelopes, unlock material. */
import { integer, jsonb, pgTable, primaryKey, text, uuid } from 'drizzle-orm/pg-core';
import { bytea, int8, tenantColumn, tstz } from './columns';

export const MEMBER_KINDS = ['password', 'browser', 'device', 'recovery', 'passkey'] as const;
export type MemberKind = (typeof MEMBER_KINDS)[number];

export const accountMembers = pgTable('account_members', {
	id: uuid('id').primaryKey(),
	storageAccountId: tenantColumn(),
	kind: text('kind', { enum: MEMBER_KINDS }).notNull(),
	memberSalt: bytea('member_salt'),
	deviceId: uuid('device_id'),
	sessionJkt: text('session_jkt'),
	signPub: jsonb('sign_pub').$type<Record<string, string>>().notNull(),
	encPub: jsonb('enc_pub').$type<Record<string, string>>().notNull(),
	labelEnc: bytea('label_enc'),
	keyStorage: text('key_storage'),
	addedSeq: int8('added_seq').notNull(),
	removedSeq: int8('removed_seq'),
	revokedAt: tstz('revoked_at'),
	lastSeenAt: tstz('last_seen_at'),
	trustExpiredAt: tstz('trust_expired_at'),
	createdAt: tstz('created_at').notNull().defaultNow(),
});

export const rosterStatements = pgTable(
	'roster_statements',
	{
		storageAccountId: tenantColumn(),
		seq: int8('seq').notNull(),
		pouchId: uuid('pouch_id'),
		prevHash: bytea('prev_hash'),
		statement: bytea('statement').notNull(),
		statementHash: bytea('statement_hash').notNull(),
		signerMemberId: uuid('signer_member_id').notNull(),
		signature: bytea('signature').notNull(),
		createdAt: tstz('created_at').notNull().defaultNow(),
	},
	(t) => [primaryKey({ columns: [t.storageAccountId, t.seq] })],
);

export const keyEnvelopes = pgTable(
	'key_envelopes',
	{
		storageAccountId: tenantColumn(),
		pouchId: uuid('pouch_id').notNull(),
		memberId: uuid('member_id').notNull(),
		keyGen: integer('key_gen').notNull(),
		hpkeEnc: bytea('hpke_enc').notNull(),
		ciphertext: bytea('ciphertext').notNull(),
		createdByMember: uuid('created_by_member').notNull(),
		signature: bytea('signature').notNull(),
		createdAt: tstz('created_at').notNull().defaultNow(),
	},
	(t) => [primaryKey({ columns: [t.pouchId, t.memberId, t.keyGen] })],
);

/** KDF parameters for the master password (Argon2id in the browser). */
export interface KdfParams {
	alg: 'argon2id';
	m: number;
	t: number;
	p: number;
}

export const accountUnlock = pgTable('account_unlock', {
	storageAccountId: uuid('storage_account_id').primaryKey(),
	kdfSalt: bytea('kdf_salt'),
	kdfParams: jsonb('kdf_params').$type<KdfParams>(),
	pepperCiphertext: bytea('pepper_ciphertext'),
	pepperKeyId: text('pepper_key_id'),
	pendingKdfSalt: bytea('pending_kdf_salt'),
	pendingKdfParams: jsonb('pending_kdf_params').$type<KdfParams>(),
	pendingPepperCiphertext: bytea('pending_pepper_ciphertext'),
	pendingPepperKeyId: text('pending_pepper_key_id'),
	pendingCreatedAt: tstz('pending_created_at'),
	failedStreak: integer('failed_streak').notNull().default(0),
	updatedAt: tstz('updated_at').notNull().defaultNow(),
});

export const passkeyUnlockers = pgTable('passkey_unlockers', {
	id: uuid('id').primaryKey(),
	storageAccountId: tenantColumn(),
	memberId: uuid('member_id').notNull(),
	credentialId: bytea('credential_id').notNull(),
	publicKey: bytea('public_key').notNull(),
	signCount: int8('sign_count').notNull().default(0),
	transports: text('transports').array(),
	label: text('label'),
	createdAt: tstz('created_at').notNull().defaultNow(),
	lastUsedAt: tstz('last_used_at'),
});

export const webauthnChallenges = pgTable('webauthn_challenges', {
	id: uuid('id').primaryKey(),
	storageAccountId: tenantColumn(),
	sessionId: text('session_id').notNull(),
	purpose: text('purpose', { enum: ['register', 'unlock'] }).notNull(),
	challenge: text('challenge').notNull(),
	expiresAt: tstz('expires_at').notNull(),
	createdAt: tstz('created_at').notNull().defaultNow(),
});

export const unlockGrants = pgTable(
	'unlock_grants',
	{
		storageAccountId: tenantColumn(),
		sessionId: text('session_id').notNull(),
		memberId: uuid('member_id').notNull(),
		expiresAt: tstz('expires_at').notNull(),
		createdAt: tstz('created_at').notNull().defaultNow(),
	},
	(t) => [primaryKey({ columns: [t.sessionId, t.memberId] })],
);
