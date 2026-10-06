// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Unlocking content in a browser (15 §4.1, §8): master-password parameters
 * and pepper, passkey (WebAuthn PRF) unlockers, trusted-browser enrollment.
 * Nothing here is a secret the server could use to decrypt: the pepper only
 * slows down guessing, the PRF output never leaves the browser.
 */
import { z } from 'zod';
import { Limits } from '../limits';
import { B64Url, Timestamp, Uuid, b64urlBytes } from './common';
import { KeyEnvelope, KeyEnvelopeInput, MemberKind, RosterStatementInput } from './roster';

export const KdfParams = z.object({
	alg: z.literal('argon2id'),
	/** Memory in KiB. */
	m: z.number().int().min(19_456).max(1_048_576),
	t: z.number().int().min(2).max(10),
	p: z.number().int().min(1).max(4),
});
export type KdfParams = z.infer<typeof KdfParams>;

export const UnlockPrepared = z.object({
	kdf_salt: b64urlBytes(16),
	kdf_params: KdfParams,
	/** 32 random bytes mixed into the Argon2id output (15 §4). */
	pepper: b64urlBytes(32),
});

export const UnlockMember = z.object({
	id: Uuid,
	kind: MemberKind,
	member_salt: B64Url.nullable(),
});

export const PasskeyUnlocker = z.object({
	id: Uuid,
	member_id: Uuid,
	credential_id: B64Url,
	transports: z.array(z.string()),
	label: z.string().nullable(),
	created_at: Timestamp,
	last_used_at: Timestamp.nullable(),
});

export const UnlockParams = z.object({
	state: z.enum(['setup_required', 'ready']),
	kdf_salt: B64Url.nullable(),
	kdf_params: KdfParams.nullable(),
	/** Active secret-derived members in unlock order: passkeys, password, recovery. */
	members: z.array(UnlockMember),
	passkeys: z.array(PasskeyUnlocker),
	browser_trust_days: z.number().int(),
	failed_streak: z.number().int(),
});

export const PepperResponse = z.object({
	pepper: b64urlBytes(32),
	/** Releases left in the current hour (10/h, 30/day). */
	remaining_this_hour: z.number().int(),
});

export const UnlockEnvelopesQuery = z.object({ member_id: Uuid });
export const UnlockEnvelopesResponse = z.object({ key_envelopes: z.array(KeyEnvelope) });

/** A new browser enrolls itself after unlocking (15 §7.3B). */
export const BrowserEnrollRequest = z.strictObject({
	/** First: `add` of this browser, signed by the unlocking member; then optional follow-ups. */
	statements: z.array(RosterStatementInput).min(1).max(8),
	key_envelopes: z.array(KeyEnvelopeInput).max(2000).default([]),
});

export const MasterPasswordChange = z.strictObject({
	/** `add(new password)` + `remove(old password)` (+ `rotate_keys`), committed with the prepared params. */
	statements: z.array(RosterStatementInput).min(2).max(8),
	key_envelopes: z.array(KeyEnvelopeInput).max(2000).default([]),
});

export const UnlockFailedResponse = z.object({ failed_streak: z.number().int() });

export const SecuritySettings = z.object({
	browser_trust_days: z
		.number()
		.int()
		.min(Limits.browserTrustDaysMin)
		.max(Limits.browserTrustDaysMax),
	auto_lock_minutes: z
		.number()
		.int()
		.min(1)
		.max(24 * 60),
});
export const SecuritySettingsPatch = SecuritySettings.partial().strict();

// ---- passkeys (WebAuthn PRF unlock, 15 §8.5) -----------------------------------

/** WebAuthn JSON shapes (as produced by @simplewebauthn/browser) are validated by the verifier. */
const WebAuthnJson = z.record(z.string(), z.unknown());

export const PasskeyOptionsResponse = z.object({ options: WebAuthnJson });

export const PasskeyRegisterRequest = z.strictObject({
	response: WebAuthnJson,
	label: z.string().trim().min(1).max(80).optional(),
	/** `add(passkey member)` signed by this unlocked browser. */
	statement: RosterStatementInput,
	key_envelopes: z.array(KeyEnvelopeInput).max(2000).default([]),
});

export const PasskeyRemoveRequest = z.strictObject({
	/** `remove(passkey member)` + `rotate_keys` (it may have been a lost security key). */
	statements: z.array(RosterStatementInput).min(1).max(4),
	key_envelopes: z.array(KeyEnvelopeInput).max(2000).default([]),
});

export const PasskeyAssertRequest = z.strictObject({ response: WebAuthnJson });
export const PasskeyAssertResponse = z.object({ member_id: Uuid, expires_at: Timestamp });
