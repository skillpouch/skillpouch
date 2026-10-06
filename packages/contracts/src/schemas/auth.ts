// SPDX-License-Identifier: AGPL-3.0-only
import { z } from 'zod';
import { Limits } from '../limits';
import {
	B64Url,
	DeviceOs,
	KeyStorage,
	P256PublicJwk,
	Timestamp,
	Uuid,
	b64urlBytes,
	b64urlMax,
} from './common';
import { KeyEnvelopeInput, RosterStatementInput } from './roster';

/** `sp_lt_` + 32 base64url characters (24 random bytes). */
export const ConnectTokenValue = z.string().regex(/^sp_lt_[A-Za-z0-9_-]{32}$/);

/** "Connect a computer": the browser asks for a one-time login token. */
export const ConnectTokenCreated = z.object({
	id: Uuid,
	token: ConnectTokenValue,
	/** Ready to paste: `npx skillpouch login <token>`. */
	command: z.string(),
	expires_at: Timestamp,
});

/**
 * waiting   — nobody has used the token yet;
 * requested — a CLI used it; `request_id` is the login request to authorize;
 * expired   — unused and past its lifetime.
 */
export const ConnectTokenStatus = z.object({
	id: Uuid,
	state: z.enum(['waiting', 'requested', 'expired']),
	request_id: Uuid.nullable(),
	expires_at: Timestamp,
});

/** Token pair issued to a CLI device. */
export const DeviceTokens = z.object({
	token_type: z.literal('DPoP'),
	access_token: z.string(),
	expires_in: z.number().int(),
	refresh_token: z.string(),
	device_id: Uuid,
	storage_account_id: Uuid,
});
export type DeviceTokens = z.infer<typeof DeviceTokens>;

export const CliAuthCreate = z.strictObject({
	/** base64url(SHA-256(code_verifier)). */
	code_challenge: b64urlBytes(32),
	device_name: z.string().trim().min(1).max(64),
	/** Assistants found on this computer (shown on the Devices page). */
	assistants: z
		.array(z.string().regex(/^[a-z0-9][a-z0-9-]{0,31}$/))
		.max(32)
		.default([]),
	os: DeviceOs,
	arch: z.string().min(1).max(32),
	cli_version: z.string().min(1).max(32),
	/** Device signing key; the DPoP proof of this request must use it. */
	sign_pub: P256PublicJwk,
	enc_pub: P256PublicJwk,
	key_storage: KeyStorage,
	/** One-time token from "Connect a computer"; links the request to that account. */
	connect_token: ConnectTokenValue.optional(),
});

export const CliAuthCreated = z.object({
	request_id: Uuid,
	authorize_url: z.url(),
	expires_in: z.number().int(),
	interval: z.number().int(),
});

export const CliAuthRequestView = z.object({
	request_id: Uuid,
	state: z.enum(['open', 'approved', 'denied', 'expired', 'redeemed']),
	/** Set when the CLI used the browser's own one-time connect token. */
	via_connect_token: z.boolean(),
	device_name: z.string(),
	os: DeviceOs,
	arch: z.string(),
	cli_version: z.string(),
	assistants: z.array(z.string()),
	key_storage: KeyStorage,
	sign_pub: P256PublicJwk,
	enc_pub: P256PublicJwk,
	jkt: z.string(),
	geo: z.string().nullable(),
	created_at: Timestamp,
	expires_at: Timestamp,
});

export const CliAuthApprove = z.strictObject({
	/** Roster `add` statement for the CLI member, signed by this browser. */
	statement: RosterStatementInput,
	/** HPKE-sealed welcome for the CLI. */
	welcome: b64urlMax(Limits.welcomeMaxBytes),
	key_envelopes: z.array(KeyEnvelopeInput).max(2000),
});

export const CliAuthTokenRequest = z.strictObject({
	request_id: Uuid,
	code_verifier: z.string().min(43).max(128),
	wait: z.number().int().min(0).max(Limits.longPollMaxWaitSeconds).default(0),
});

export const CliAuthTokenResponse = z.discriminatedUnion('status', [
	z.object({ status: z.literal('pending'), interval: z.number().int() }),
	DeviceTokens.extend({ status: z.literal('approved'), welcome: B64Url }),
]);

export const RefreshRequest = z.strictObject({ refresh_token: z.string().min(10).max(300) });

export const NonceResponse = z.object({ nonce: z.string() });

export const SessionBindResponse = z.object({ jkt: z.string() });
