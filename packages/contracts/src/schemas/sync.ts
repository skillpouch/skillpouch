// SPDX-License-Identifier: AGPL-3.0-only
import { z } from 'zod';
import { Limits } from '../limits';
import { B64Url, BlobId, Hash32, Timestamp, Uuid, b64urlMax } from './common';

// ---- blobs ---------------------------------------------------------

export const BlobCheckRequest = z.strictObject({
	blobs: z
		.array(
			z.strictObject({
				id: BlobId,
				stored_size: z.number().int().min(1).max(Limits.blobMaxStoredBytes),
			}),
		)
		.min(1)
		.max(Limits.blobCheckMax),
});

export const BlobCheckResponse = z.object({ missing: z.array(BlobId) });

export const BlobPutResponse = z.object({ blob_id: BlobId, stored_size: z.number().int() });

export const BlobFetchRequest = z.strictObject({
	ids: z.array(BlobId).min(1).max(Limits.blobBatchMaxParts),
});

export const BlobBatchResponse = z.object({ stored: z.array(BlobId) });

// ---- operations ----------------------------------------------------

export const OperationType = z.enum(['create', 'update', 'rename', 'delete', 'restore', 'resolve']);
export type OperationType = z.infer<typeof OperationType>;

export const Operation = z.strictObject({
	type: OperationType,
	artifact_id: Uuid,
	revision_id: Uuid,
	base_revision_id: Uuid.nullable(),
	/** Second parent for merges/resolutions. */
	merge_parent_id: Uuid.nullable().default(null),
	/** Required for create, rename, restore. */
	name_index: Hash32.nullable().default(null),
	/** Required for resolve. */
	conflict_id: Uuid.nullable().default(null),
	key_gen: z.number().int().min(1),
	envelope: b64urlMax(Limits.envelopeMaxBytes),
	signature: b64urlMax(256),
	signer_member_id: Uuid,
	blob_ids: z.array(BlobId).max(Limits.revisionMaxBlobs),
});
export type Operation = z.infer<typeof Operation>;

export const CommitRequest = z.strictObject({
	operation_id: Uuid,
	epoch: Uuid,
	ops: z.array(Operation).min(1).max(Limits.opsPerRequest),
});
export type CommitRequest = z.infer<typeof CommitRequest>;

export const OperationResult = z.discriminatedUnion('status', [
	z.object({
		status: z.literal('applied'),
		artifact_id: Uuid,
		revision_id: Uuid,
		seq: z.number().int(),
	}),
	z.object({
		status: z.literal('conflict'),
		artifact_id: Uuid,
		revision_id: Uuid,
		conflict_id: Uuid,
		conflict_type: z.enum(['update_update', 'edit_delete', 'delete_edit', 'name_collision']),
		server_revision_id: Uuid.nullable(),
		seq: z.number().int(),
	}),
	z.object({
		status: z.literal('rejected'),
		artifact_id: Uuid,
		revision_id: Uuid,
		code: z.string(),
		message: z.string(),
	}),
]);
export type OperationResult = z.infer<typeof OperationResult>;

export const CommitResponse = z.object({
	results: z.array(OperationResult),
	high_water: z.number().int(),
});
export type CommitResponse = z.infer<typeof CommitResponse>;

// ---- revisions & artifacts ---------------------------------------------------

export const Revision = z.object({
	id: Uuid,
	artifact_id: Uuid,
	parent_id: Uuid.nullable(),
	merge_parent_id: Uuid.nullable(),
	envelope: B64Url,
	envelope_hash: Hash32,
	signature: B64Url,
	signer_member_id: Uuid,
	key_gen: z.number().int(),
	stored_size: z.number().int(),
	origin: z.enum(['daemon', 'web', 'restore', 'resolve', 'import']),
	author_device_id: Uuid.nullable(),
	blob_ids: z.array(BlobId),
	created_at: Timestamp,
});
export type Revision = z.infer<typeof Revision>;

export const Artifact = z.object({
	id: Uuid,
	name_index: Hash32,
	deleted_at: Timestamp.nullable(),
	updated_at: Timestamp,
	head: Revision.nullable(),
});

export const ArtifactListQuery = z.object({
	cursor: z.string().max(200).optional(),
	limit: z.coerce.number().int().min(1).max(Limits.pageMax).default(100),
	include_deleted: z.stringbool().default(false),
});

export const RevisionsQuery = z.object({
	ids: z
		.string()
		.transform((value) => value.split(',').filter(Boolean))
		.pipe(z.array(Uuid).min(1).max(Limits.pageMax)),
});

// ---- events ------------------------------------------------------------

export const EventType = z.enum([
	'artifact.created',
	'artifact.updated',
	'artifact.renamed',
	'artifact.deleted',
	'artifact.restored',
	'conflict.opened',
	'conflict.resolved',
	'binding.changed',
	'pouch.epoch_rotated',
]);
export type EventType = z.infer<typeof EventType>;

export const PouchEvent = z.object({
	seq: z.number().int(),
	type: EventType,
	artifact_id: Uuid.nullable(),
	revision_id: Uuid.nullable(),
	operation_id: Uuid.nullable(),
	device_id: Uuid.nullable(),
	payload: z.record(z.string(), z.unknown()),
	created_at: Timestamp,
});

export const EventsQuery = z.object({
	after: z.coerce.number().int().min(0),
	epoch: Uuid,
	limit: z.coerce.number().int().min(1).max(500).default(500),
	wait: z.coerce.number().int().min(0).max(Limits.longPollMaxWaitSeconds).default(0),
});

export const EventsResponse = z.object({
	events: z.array(PouchEvent),
	next_cursor: z.number().int(),
	high_water: z.number().int(),
	epoch: Uuid,
});

/** Account-level events pushed on the SSE stream. */
export const AccountEventType = z.enum([
	'roster.changed',
	'browser.trusted',
	'unlock.failed_streak',
	'pouch.state_changed',
	'device.revoked',
	'entitlements.changed',
	'usage.changed',
	'cli_auth.requested',
	'cli_auth.approved',
]);

// ---- snapshots -----------------------------------------------------------

export const SnapshotCreated = z.object({
	snapshot_id: Uuid,
	epoch: Uuid,
	seq: z.number().int(),
	expires_at: Timestamp,
});

export const SnapshotPage = z.object({
	artifacts: z.array(
		z.object({
			id: Uuid,
			name_index: Hash32,
			deleted_at: Timestamp.nullable(),
			head: Revision,
		}),
	),
});

// ---- conflicts -----------------------------------------------------------

export const Conflict = z.object({
	id: Uuid,
	artifact_id: Uuid.nullable(),
	type: z.enum([
		'update_update',
		'edit_delete',
		'delete_edit',
		'name_collision',
		'local_projection',
	]),
	base_revision_id: Uuid.nullable(),
	server_revision_id: Uuid.nullable(),
	incoming_revision_id: Uuid.nullable(),
	device_id: Uuid.nullable(),
	state: z.enum(['open', 'resolved', 'superseded']),
	resolution: z.string().nullable(),
	created_at: Timestamp,
	resolved_at: Timestamp.nullable(),
});

export const ConflictListQuery = z.object({
	state: z.enum(['open', 'resolved', 'superseded']).optional(),
});

// ---- bindings & checkpoints --------------------------------------------------------

export const Binding = z.object({
	artifact_id: Uuid,
	device_id: Uuid,
	payload: B64Url,
	key_gen: z.number().int(),
	updated_at: Timestamp,
});

export const BindingsPut = z.strictObject({
	bindings: z
		.array(
			z.strictObject({
				artifact_id: Uuid,
				payload: b64urlMax(Limits.bindingPayloadMaxBytes).nullable(),
				key_gen: z.number().int().min(1),
			}),
		)
		.min(1)
		.max(500),
});

export const CheckpointPut = z.strictObject({
	member_id: Uuid,
	pouch_seq: z.number().int().min(0),
	roster_head: Hash32,
	signature: b64urlMax(256),
});

export const Checkpoint = CheckpointPut.extend({ created_at: Timestamp });
