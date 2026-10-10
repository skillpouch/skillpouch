// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Secret-derived members: the master password, the Recovery Key and passkeys
 * never store a private key anywhere. Their key pairs are re-derived on
 * demand:
 *
 *   seed = HKDF-SHA256(ikm = secret, salt = member_salt, info = "skillpouch/v1/member-seed/<kind>")
 *
 * where `secret` is
 *   - password: Argon2id(NFKC(master password), account_kdf_salt, params) ‖ unlock_pepper
 *   - recovery: the 16 bytes of entropy behind the 12-word Recovery Key
 *   - passkey:  the 32-byte WebAuthn PRF output for `prfInput(member_salt)`
 *
 * A wrong secret derives a different public key than the roster entry; the
 * caller compares and reports "wrong master password" locally.
 */
import { hkdf } from '@noble/hashes/hkdf.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { entropyToMnemonic, mnemonicToEntropy, validateMnemonic } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english.js';
import { argon2id } from 'hash-wasm';
import { concat, randomBytes, utf8, wipe } from './bytes';
import { CryptoError } from './errors';
import { deriveMemberKeyPair, sameKey, type MemberKeyPair, type PublicJwk } from './keys';

export type SecretMemberKind = 'password' | 'recovery' | 'passkey';

export interface KdfParams {
	alg: 'argon2id';
	/** Memory in KiB. */
	m: number;
	t: number;
	p: number;
}

export function memberSeed(
	kind: SecretMemberKind,
	secret: Uint8Array,
	memberSalt: Uint8Array,
): Uint8Array {
	return hkdf(sha256, secret, memberSalt, utf8(`skillpouch/v1/member-seed/${kind}`), 32);
}

/** Derives the member key pair for a secret; wipes the intermediate seed. */
export async function secretMemberKeys(
	kind: SecretMemberKind,
	secret: Uint8Array,
	memberSalt: Uint8Array,
): Promise<MemberKeyPair> {
	const seed = memberSeed(kind, secret, memberSalt);
	try {
		return await deriveMemberKeyPair(seed);
	} finally {
		wipe(seed);
	}
}

/** Throws `wrong_secret` when derived keys don't match the roster's public key. */
export function assertMatchesRoster(keys: MemberKeyPair, rosterSignPub: PublicJwk): void {
	if (!sameKey(keys.signPub, rosterSignPub)) {
		throw new CryptoError('wrong_secret', 'the secret does not match this account');
	}
}

// ---- master password ---------------------------------------------------------

export async function passwordSecret(
	password: string,
	kdfSalt: Uint8Array,
	params: KdfParams,
	pepper: Uint8Array,
): Promise<Uint8Array> {
	const stretched = await argon2id({
		password: password.normalize('NFKC'),
		salt: kdfSalt,
		parallelism: params.p,
		iterations: params.t,
		memorySize: params.m,
		hashLength: 32,
		outputType: 'binary',
	});
	try {
		return concat(stretched, pepper);
	} finally {
		wipe(stretched);
	}
}

export interface PasswordCheck {
	ok: boolean;
	reason?: 'too_short' | 'too_simple' | 'mismatch';
}

/** Local rules for a new master password: ≥ 12 characters and not one repeated or trivial pattern. */
export function checkNewPassword(password: string, confirmation?: string): PasswordCheck {
	if ([...password].length < 12) return { ok: false, reason: 'too_short' };
	const lowered = password.toLowerCase();
	if (new Set(lowered).size < 5 || /^(.{1,3})\1+$/.test(lowered)) {
		return { ok: false, reason: 'too_simple' };
	}
	if (confirmation !== undefined && confirmation !== password) {
		return { ok: false, reason: 'mismatch' };
	}
	return { ok: true };
}

// ---- Recovery Key --------------------------------------------------------------

export interface RecoveryKey {
	/** 12 English BIP-39 words (128 bits of entropy + checksum). */
	words: string[];
	entropy: Uint8Array;
}

export function generateRecoveryKey(): RecoveryKey {
	const entropy = randomBytes(16);
	return { entropy, words: entropyToMnemonic(entropy, wordlist).split(' ') };
}

/** Normalizes whatever the user pasted (case, extra spaces, line breaks). */
export function normalizeRecoveryText(text: string): string {
	return text.toLowerCase().trim().split(/\s+/).join(' ');
}

export function isValidRecoveryKey(text: string): boolean {
	return validateMnemonic(normalizeRecoveryText(text), wordlist);
}

export function parseRecoveryKey(text: string): RecoveryKey {
	const normalized = normalizeRecoveryText(text);
	if (!validateMnemonic(normalized, wordlist)) {
		throw new CryptoError('wrong_secret', 'not a valid Recovery Key');
	}
	return { words: normalized.split(' '), entropy: mnemonicToEntropy(normalized, wordlist) };
}

// ---- passkey (WebAuthn PRF) ---------------------------------------------------------

/** WebAuthn PRF (CTAP2 `hmac-secret`) outputs are always 32 bytes. */
export const PRF_OUTPUT_BYTES = 32;

/** The PRF `eval.first` input for a passkey member. */
export function prfInput(memberSalt: Uint8Array): Uint8Array {
	return concat('skillpouch/v1/prf', memberSalt);
}

/**
 * The `passkey` member's key pair from the PRF output for `prfInput(memberSalt)`.
 * Anything but a 32-byte output means the authenticator didn't evaluate PRF.
 */
export async function passkeyMemberKeys(
	prfOutput: Uint8Array,
	memberSalt: Uint8Array,
): Promise<MemberKeyPair> {
	if (prfOutput.length !== PRF_OUTPUT_BYTES) {
		throw new CryptoError('wrong_secret', 'This passkey didn’t return an unlock secret.');
	}
	return secretMemberKeys('passkey', prfOutput, memberSalt);
}

export function newMemberSalt(): Uint8Array {
	return randomBytes(16);
}
