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

/** Token pair issued to a CLI device (08 §3). */
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
	os: DeviceOs,
	arch: z.string().min(1).max(32),
	cli_version: z.string().min(1).max(32),
	/** Device signing key; the DPoP proof of this request must use it. */
	sign_pub: P256PublicJwk,
	enc_pub: P256PublicJwk,
	key_storage: KeyStorage,
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
	device_name: z.string(),
	os: DeviceOs,
	arch: z.string(),
	cli_version: z.string(),
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
	/** HPKE-sealed welcome for the CLI (15 §7.3A). */
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
