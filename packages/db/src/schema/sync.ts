// SPDX-License-Identifier: AGPL-3.0-only
/** Pouches and the sync data model. */
import { boolean, integer, jsonb, pgTable, primaryKey, text, uuid } from 'drizzle-orm/pg-core';
import { bytea, int8, tenantColumn, tstz } from './columns';

export const pouches = pgTable('pouches', {
	id: uuid('id').primaryKey(),
	storageAccountId: tenantColumn(),
	createdSeq: int8('created_seq').notNull(),
	state: text('state', { enum: ['active', 'locked', 'archived', 'deleted'] })
		.notNull()
		.default('active'),
	epoch: uuid('epoch').notNull(),
	eventSeq: int8('event_seq').notNull().default(0),
	eventsPurgedThrough: int8('events_purged_through').notNull().default(0),
	keyGen: integer('key_gen').notNull().default(1),
	deleteAfter: tstz('delete_after'),
	createdAt: tstz('created_at').notNull().defaultNow(),
	updatedAt: tstz('updated_at').notNull().defaultNow(),
});

export const deviceCursors = pgTable(
	'device_cursors',
	{
		storageAccountId: tenantColumn(),
		deviceId: uuid('device_id').notNull(),
		pouchId: uuid('pouch_id').notNull(),
		epoch: uuid('epoch').notNull(),
		ackedSeq: int8('acked_seq').notNull(),
		updatedAt: tstz('updated_at').notNull().defaultNow(),
	},
	(t) => [primaryKey({ columns: [t.deviceId, t.pouchId] })],
);

export const blobs = pgTable(
	'blobs',
	{
		storageAccountId: tenantColumn(),
		pouchId: uuid('pouch_id').notNull(),
		blobId: bytea('blob_id').notNull(),
		ciphertextHash: bytea('ciphertext_hash'),
		storedSize: int8('stored_size').notNull(),
		keyGen: integer('key_gen'),
		refCount: integer('ref_count').notNull().default(0),
		state: text('state', { enum: ['pending', 'stored'] }).notNull(),
		createdAt: tstz('created_at').notNull().defaultNow(),
		unreferencedSince: tstz('unreferenced_since'),
	},
	(t) => [primaryKey({ columns: [t.storageAccountId, t.pouchId, t.blobId] })],
);

export const artifacts = pgTable('artifacts', {
	id: uuid('id').primaryKey(),
	storageAccountId: tenantColumn(),
	pouchId: uuid('pouch_id').notNull(),
	nameIndex: bytea('name_index').notNull(),
	headRevisionId: uuid('head_revision_id'),
	deletedAt: tstz('deleted_at'),
	createdAt: tstz('created_at').notNull().defaultNow(),
	updatedAt: tstz('updated_at').notNull().defaultNow(),
});

export type RevisionOrigin = 'daemon' | 'web' | 'restore' | 'resolve' | 'import';

export const revisions = pgTable('revisions', {
	id: uuid('id').primaryKey(),
	storageAccountId: tenantColumn(),
	pouchId: uuid('pouch_id').notNull(),
	artifactId: uuid('artifact_id').notNull(),
	parentId: uuid('parent_id'),
	mergeParentId: uuid('merge_parent_id'),
	envelope: bytea('envelope').notNull(),
	envelopeHash: bytea('envelope_hash').notNull(),
	signature: bytea('signature').notNull(),
	signerMemberId: uuid('signer_member_id').notNull(),
	keyGen: integer('key_gen').notNull(),
	storedSize: int8('stored_size').notNull(),
	authorDeviceId: uuid('author_device_id'),
	authorUserId: text('author_user_id').notNull(),
	origin: text('origin', { enum: ['daemon', 'web', 'restore', 'resolve', 'import'] }).notNull(),
	createdAt: tstz('created_at').notNull().defaultNow(),
	expiresAt: tstz('expires_at'),
});

export const revisionBlobs = pgTable(
	'revision_blobs',
	{
		storageAccountId: tenantColumn(),
		pouchId: uuid('pouch_id').notNull(),
		revisionId: uuid('revision_id').notNull(),
		blobId: bytea('blob_id').notNull(),
	},
	(t) => [primaryKey({ columns: [t.revisionId, t.blobId] })],
);

export const bindings = pgTable(
	'bindings',
	{
		storageAccountId: tenantColumn(),
		pouchId: uuid('pouch_id').notNull(),
		artifactId: uuid('artifact_id').notNull(),
		deviceId: uuid('device_id').notNull(),
		payload: bytea('payload').notNull(),
		keyGen: integer('key_gen').notNull(),
		updatedAt: tstz('updated_at').notNull().defaultNow(),
	},
	(t) => [primaryKey({ columns: [t.artifactId, t.deviceId] })],
);

export const events = pgTable(
	'events',
	{
		storageAccountId: tenantColumn(),
		pouchId: uuid('pouch_id').notNull(),
		seq: int8('seq').notNull(),
		epoch: uuid('epoch').notNull(),
		type: text('type').notNull(),
		artifactId: uuid('artifact_id'),
		revisionId: uuid('revision_id'),
		operationId: uuid('operation_id'),
		deviceId: uuid('device_id'),
		payload: jsonb('payload').$type<Record<string, unknown>>().notNull().default({}),
		createdAt: tstz('created_at').notNull().defaultNow(),
	},
	(t) => [primaryKey({ columns: [t.pouchId, t.seq] })],
);

export const operationReceipts = pgTable(
	'operation_receipts',
	{
		storageAccountId: tenantColumn(),
		pouchId: uuid('pouch_id').notNull(),
		operationId: uuid('operation_id').notNull(),
		requestDigest: bytea('request_digest').notNull(),
		status: text('status', { enum: ['applied', 'conflict', 'rejected', 'mixed'] }).notNull(),
		response: jsonb('response').notNull(),
		deviceId: uuid('device_id'),
		deviceJkt: text('device_jkt'),
		deviceSignature: text('device_signature'),
		createdAt: tstz('created_at').notNull().defaultNow(),
	},
	(t) => [primaryKey({ columns: [t.pouchId, t.operationId] })],
);

export type ConflictType =
	'update_update' | 'edit_delete' | 'delete_edit' | 'name_collision' | 'local_projection';

export const conflicts = pgTable('conflicts', {
	id: uuid('id').primaryKey(),
	storageAccountId: tenantColumn(),
	pouchId: uuid('pouch_id').notNull(),
	artifactId: uuid('artifact_id'),
	type: text('type', {
		enum: ['update_update', 'edit_delete', 'delete_edit', 'name_collision', 'local_projection'],
	}).notNull(),
	baseRevisionId: uuid('base_revision_id'),
	serverRevisionId: uuid('server_revision_id'),
	incomingRevisionId: uuid('incoming_revision_id'),
	deviceId: uuid('device_id'),
	state: text('state', { enum: ['open', 'resolved', 'superseded'] })
		.notNull()
		.default('open'),
	resolution: text('resolution'),
	resolvedBy: text('resolved_by'),
	createdAt: tstz('created_at').notNull().defaultNow(),
	resolvedAt: tstz('resolved_at'),
});

export const checkpoints = pgTable(
	'checkpoints',
	{
		storageAccountId: tenantColumn(),
		pouchId: uuid('pouch_id').notNull(),
		memberId: uuid('member_id').notNull(),
		pouchSeq: int8('pouch_seq').notNull(),
		rosterHead: bytea('roster_head').notNull(),
		signature: bytea('signature').notNull(),
		createdAt: tstz('created_at').notNull().defaultNow(),
	},
	(t) => [primaryKey({ columns: [t.pouchId, t.memberId] })],
);

export const snapshots = pgTable('snapshots', {
	id: uuid('id').primaryKey(),
	storageAccountId: tenantColumn(),
	pouchId: uuid('pouch_id').notNull(),
	epoch: uuid('epoch').notNull(),
	seq: int8('seq').notNull(),
	expiresAt: tstz('expires_at').notNull(),
	createdAt: tstz('created_at').notNull().defaultNow(),
});

/** Share links: one sealed item, readable only with the key in the link fragment. */
export const shares = pgTable('shares', {
	id: uuid('id').primaryKey(),
	storageAccountId: tenantColumn(),
	pouchId: uuid('pouch_id').notNull(),
	createdByMember: uuid('created_by_member').notNull(),
	labelEnc: bytea('label_enc').notNull(),
	ciphertext: bytea('ciphertext').notNull(),
	storedSize: integer('stored_size').notNull(),
	oneTime: boolean('one_time').notNull().default(false),
	expiresAt: tstz('expires_at'),
	revokedAt: tstz('revoked_at'),
	consumedAt: tstz('consumed_at'),
	views: integer('views').notNull().default(0),
	imports: integer('imports').notNull().default(0),
	lastImportedAt: tstz('last_imported_at'),
	createdAt: tstz('created_at').notNull().defaultNow(),
});
