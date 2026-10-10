// SPDX-License-Identifier: AGPL-3.0-only
import { z } from 'zod';
import { B64Url, DeviceOs, Hash32, KeyStorage, Timestamp, Uuid } from './common';
import { KeyEnvelopeInput, RosterAppendRequest, RosterStatementInput } from './roster';

export const Entitlements = z.object({
	plan_slug: z.string(),
	plan_name: z.string(),
	source: z.enum(['default', 'subscription', 'grant', 'override']),
	pouch_limit: z.number().int(),
	storage_bytes: z.number().int(),
});
export type Entitlements = z.infer<typeof Entitlements>;

export const MeResponse = z.object({
	user: z.object({
		id: z.string(),
		email: z.string(),
		name: z.string(),
		image: z.string().nullable(),
		role: z.enum(['user', 'admin']),
	}),
	account: z.object({
		id: Uuid,
		entitlements: Entitlements,
		quota_bytes: z.number().int(),
		used_bytes: z.number().int(),
		roster_initialized: z.boolean(),
		genesis_hash: Hash32.nullable(),
		roster_seq: z.number().int(),
		delete_after: Timestamp.nullable(),
	}),
	session: z
		.object({ bound: z.boolean(), jkt: z.string().nullable(), step_up_fresh: z.boolean() })
		.nullable(),
	device: z.object({ id: Uuid, name: z.string() }).nullable(),
});

export const Plan = z.object({
	slug: z.string(),
	name: z.string(),
	description: z.string(),
	price_cents: z.number().int(),
	currency: z.string(),
	interval: z.enum(['month', 'year']).nullable(),
	pouch_limit: z.number().int(),
	storage_bytes: z.number().int(),
});

/** AI assistant detected on a computer, e.g. `claude-code`, `opencode`, `codex`. */
export const AssistantId = z.string().regex(/^[a-z0-9][a-z0-9-]{0,31}$/);

export const DeviceName = z.string().trim().min(1).max(64);

export const Device = z.object({
	id: Uuid,
	name: z.string(),
	os: DeviceOs,
	arch: z.string(),
	cli_version: z.string(),
	assistants: z.array(z.string()),
	/** Last acknowledged event per pouch; compare with `Pouch.event_seq` for "synced". */
	cursors: z.array(z.object({ pouch_id: Uuid, acked_seq: z.number().int() })),
	state: z.enum(['active', 'suspended', 'revoked']),
	key_storage: KeyStorage.nullable(),
	member_id: Uuid.nullable(),
	active_pouch_id: Uuid.nullable(),
	last_seen_at: Timestamp.nullable(),
	revoked_at: Timestamp.nullable(),
	created_at: Timestamp,
	is_current: z.boolean(),
});

export const BrowserMember = z.object({
	member_id: Uuid,
	label_enc: B64Url.nullable(),
	last_seen_at: Timestamp.nullable(),
	revoked_at: Timestamp.nullable(),
	removed_seq: z.number().int().nullable(),
	is_current: z.boolean(),
});

export const DeviceList = z.object({
	devices: z.array(Device),
	browsers: z.array(BrowserMember),
});

/** Revoke: optional signed `remove` + `rotate_keys` from an unlocked member. */
export const RevokeRequest = z.strictObject({
	roster: RosterAppendRequest.optional(),
	reason: z.string().max(200).optional(),
});

export const RevokeResponse = z.object({
	revoked: z.literal(true),
	rotation_pending: z.boolean(),
});

export const CursorReport = z.strictObject({
	pouch_id: Uuid,
	epoch: Uuid,
	acked_seq: z.number().int().min(0),
});

export const ActivePouchReport = z.strictObject({ pouch_id: Uuid.nullable() });

export const DeviceRename = z.strictObject({ name: DeviceName });

/** What the CLI reports about itself after start-up and upgrades. */
export const DeviceSelfReport = z.strictObject({
	cli_version: z.string().min(1).max(32).optional(),
	assistants: z.array(AssistantId).max(32).optional(),
});

export const Pouch = z.object({
	id: Uuid,
	state: z.enum(['active', 'locked', 'archived', 'deleted']),
	epoch: Uuid,
	event_seq: z.number().int(),
	key_gen: z.number().int(),
	created_seq: z.number().int(),
	delete_after: Timestamp.nullable(),
	created_at: Timestamp,
});
export type Pouch = z.infer<typeof Pouch>;

export const PouchCreate = z.strictObject({
	statement: RosterStatementInput,
	key_envelopes: z.array(KeyEnvelopeInput).min(1).max(2000),
});

export const PouchUpdate = z.strictObject({ statement: RosterStatementInput });

/** Query of `DELETE /v1/pouches/:id`: `skip_undo` frees the space right away. */
export const PouchDeleteQuery = z.strictObject({
	skip_undo: z.enum(['true', 'false']).default('false'),
});

/**
 * `POST /v1/pouches/:id/activate` — make a locked pouch the active one.
 * At the pouch limit, `lock_pouch_id` names the active pouch that
 * takes its place as locked.
 */
export const PouchActivate = z.strictObject({ lock_pouch_id: Uuid.optional() });

/**
 * Storage used by one artifact, for the "Free up space" picker.
 * Name and kind are encrypted; the browser joins them by `id`.
 */
export const ArtifactUsage = z.object({
	id: Uuid,
	deleted: z.boolean(),
	/** Bytes of the current version (blobs + envelope). */
	head_bytes: z.number().int(),
	/** Bytes only older versions use — freed by removing history. */
	history_bytes: z.number().int(),
	updated_at: Timestamp,
});

export const PouchUsage = z.object({
	id: Uuid,
	state: Pouch.shape.state,
	/** Everything this pouch stores (blobs + envelopes). */
	bytes: z.number().int(),
	/** Freed by "Old versions & trash" (non-current revisions, not pinned by open conflicts). */
	history_bytes: z.number().int(),
	artifacts: z.array(ArtifactUsage),
});

export const StorageUsage = z.object({
	used_bytes: z.number().int(),
	quota_bytes: z.number().int(),
	over_quota_since: Timestamp.nullable(),
	pouch_limit: z.number().int(),
	pouches: z.array(PouchUsage),
});

/**
 * `POST /v1/pouches/:id/free-space`. Without `artifact_ids`: removes every
 * older version and trashed item of the pouch. With them: removes all older
 * versions of those artifacts, which must already be deleted by a signed
 * `delete` operation (content stays end-to-end encrypted; the server never
 * decides what to delete).
 */
export const FreeSpaceRequest = z.strictObject({
	artifact_ids: z.array(Uuid).min(1).max(5000).optional(),
});

export const FreeSpaceResponse = z.object({
	freed_bytes: z.number().int(),
	used_bytes: z.number().int(),
	quota_bytes: z.number().int(),
	over_quota: z.boolean(),
});

export const SecurityEvent = z.object({
	id: Uuid,
	kind: z.string(),
	severity: z.enum(['info', 'warning', 'critical']),
	details: z.record(z.string(), z.unknown()),
	created_at: Timestamp,
	acknowledged_at: Timestamp.nullable(),
});

export const ClientSecurityReport = z.strictObject({
	kind: z.enum([
		'signature_invalid',
		'roster_fork',
		'roster_rollback',
		'revision_rollback',
		'aead_failure',
		'blob_id_mismatch',
		'envelope_mismatch',
	]),
	pouch_id: Uuid.optional(),
	details: z.record(z.string(), z.union([z.string().max(200), z.number()])).default({}),
});

export const CliLatest = z.object({
	version: z.string(),
	min_supported: z.string(),
});
