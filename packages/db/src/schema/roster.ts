// SPDX-License-Identifier: AGPL-3.0-only
/** E2EE membership: members, roster chain, key envelopes, join requests (03 §5.12a, 15). */
import { integer, jsonb, pgTable, primaryKey, text, uuid } from 'drizzle-orm/pg-core';
import { bytea, int8, tenantColumn, tstz } from './columns';

export type MemberKind = 'device' | 'browser' | 'recovery';

export const accountMembers = pgTable('account_members', {
	id: uuid('id').primaryKey(),
	storageAccountId: tenantColumn(),
	kind: text('kind', { enum: ['device', 'browser', 'recovery'] }).notNull(),
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

export const joinRequests = pgTable('join_requests', {
	id: uuid('id').primaryKey(),
	storageAccountId: tenantColumn(),
	request: bytea('request').notNull(),
	requestHash: bytea('request_hash').notNull(),
	requesterJkt: text('requester_jkt').notNull(),
	state: text('state', { enum: ['open', 'approved', 'denied', 'expired'] })
		.notNull()
		.default('open'),
	welcome: bytea('welcome'),
	approvedByMember: uuid('approved_by_member'),
	expiresAt: tstz('expires_at').notNull(),
	createdAt: tstz('created_at').notNull().defaultNow(),
});
