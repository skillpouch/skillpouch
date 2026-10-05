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

export const Device = z.object({
	id: Uuid,
	name: z.string(),
	os: DeviceOs,
	arch: z.string(),
	cli_version: z.string(),
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

/** Revoke: optional signed `remove` + `rotate_keys` from an unlocked member (15 §7.4). */
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

export const Pouch = z.object({
	id: Uuid,
	state: z.enum(['active', 'read_only', 'archived', 'deleted']),
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
