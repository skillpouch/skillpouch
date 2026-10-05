// SPDX-License-Identifier: AGPL-3.0-only
/** CLI devices, their keys, CLI login requests and DPoP replay cache (03 §5.4, 08 §3, §6). */
import { integer, jsonb, pgTable, primaryKey, text, uuid } from 'drizzle-orm/pg-core';
import { bytea, tenantColumn, tstz } from './columns';

export type DeviceState = 'active' | 'suspended' | 'revoked';

export const devices = pgTable('devices', {
	id: uuid('id').primaryKey(),
	storageAccountId: tenantColumn(),
	userId: text('user_id').notNull(),
	name: text('name').notNull(),
	os: text('os', { enum: ['linux', 'macos', 'windows'] }).notNull(),
	arch: text('arch').notNull(),
	cliVersion: text('cli_version').notNull(),
	activePouchId: uuid('active_pouch_id'),
	state: text('state', { enum: ['active', 'suspended', 'revoked'] })
		.notNull()
		.default('active'),
	authorizedFrom: uuid('authorized_from'),
	tokenVersion: integer('token_version').notNull().default(1),
	refreshHash: bytea('refresh_hash').notNull(),
	refreshFamilyId: uuid('refresh_family_id').notNull(),
	prevRefreshHash: bytea('prev_refresh_hash'),
	registeredIpHash: bytea('registered_ip_hash'),
	lastSeenAt: tstz('last_seen_at'),
	lastIpHash: bytea('last_ip_hash'),
	revokedAt: tstz('revoked_at'),
	revokeReason: text('revoke_reason'),
	createdAt: tstz('created_at').notNull().defaultNow(),
});

export const deviceKeys = pgTable(
	'device_keys',
	{
		storageAccountId: tenantColumn(),
		deviceId: uuid('device_id').notNull(),
		jkt: text('jkt').notNull(),
		publicJwk: jsonb('public_jwk').$type<Record<string, string>>().notNull(),
		keyStorage: text('key_storage', {
			enum: ['tpm', 'secure_enclave', 'os_keystore', 'file'],
		}).notNull(),
		createdAt: tstz('created_at').notNull().defaultNow(),
		retiredAt: tstz('retired_at'),
	},
	(t) => [primaryKey({ columns: [t.storageAccountId, t.deviceId, t.jkt] })],
);

export const dpopReplay = pgTable('dpop_replay', {
	jti: text('jti').primaryKey(),
	expiresAt: tstz('expires_at').notNull(),
});

export type CliAuthState = 'open' | 'approved' | 'denied' | 'expired' | 'redeemed';

export const cliAuthRequests = pgTable('cli_auth_requests', {
	id: uuid('id').primaryKey(),
	codeChallenge: bytea('code_challenge').notNull(),
	jkt: text('jkt').notNull(),
	signPub: jsonb('sign_pub').$type<Record<string, string>>().notNull(),
	encPub: jsonb('enc_pub').$type<Record<string, string>>().notNull(),
	keyStorage: text('key_storage', {
		enum: ['tpm', 'secure_enclave', 'os_keystore', 'file'],
	}).notNull(),
	deviceName: text('device_name').notNull(),
	os: text('os', { enum: ['linux', 'macos', 'windows'] }).notNull(),
	arch: text('arch').notNull(),
	cliVersion: text('cli_version').notNull(),
	ipHash: bytea('ip_hash').notNull(),
	geo: text('geo'),
	state: text('state', { enum: ['open', 'approved', 'denied', 'expired', 'redeemed'] })
		.notNull()
		.default('open'),
	storageAccountId: uuid('storage_account_id'),
	approvedByMember: uuid('approved_by_member'),
	deviceId: uuid('device_id'),
	welcome: bytea('welcome'),
	expiresAt: tstz('expires_at').notNull(),
	finalizedAt: tstz('finalized_at'),
	createdAt: tstz('created_at').notNull().defaultNow(),
});
