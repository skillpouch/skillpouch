// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Unlocking on a browser that isn't a member yet (or whose trust lapsed).
 *
 * The secret — master password or Recovery Key here, a passkey in
 * `passkeys.ts` — re-derives a roster member's
 * key pair locally. If its public key matches the roster, the member's key
 * envelopes open the pouch keys, and that member signs this browser into the
 * roster (or, after a lapse, re-confirms its trust). The secret itself never
 * leaves the page.
 */
import {
	CryptoError,
	buildAddMember,
	jwkThumbprint,
	memberEntry,
	openKeyring,
	parseRecoveryKey,
	sameKey,
	secretMemberKeys,
	sign,
	unb64,
	utf8,
	type Keyring,
	type MemberKeyPair,
} from '@skillpouch/crypto';
import { api } from '@/lib/api/client';
import type { KeyEnvelopeRecord, UnlockParamsRecord } from '@/lib/api/types';
import { updateBrowserKey, type StoredBrowserKey } from './key-store';
import { derivePasswordSecret } from './password';
import { loadVerifiedRoster } from './roster';

export type UnlockMethod = 'password' | 'recovery';

export interface UnlockContext {
	accountId: string;
	browser: StoredBrowserKey;
	/**
	 * What this browser already is: not a member (enroll it), a member whose
	 * trust window lapsed (renew it), or an untrusted member (re-prove the secret).
	 */
	membership: 'none' | 'expired' | 'untrusted';
}

export const RENEW_TRUST_CONTEXT = 'skillpouch/v1/renew-trust';

export function fetchUnlockParams(): Promise<UnlockParamsRecord> {
	return api.get<UnlockParamsRecord>('/v1/account/unlock/params');
}

async function deriveKeys(
	method: UnlockMethod,
	secretText: string,
	params: UnlockParamsRecord,
	memberSalt: Uint8Array,
): Promise<MemberKeyPair> {
	if (method === 'recovery') {
		let entropy: Uint8Array;
		try {
			entropy = parseRecoveryKey(secretText).entropy;
		} catch {
			throw new CryptoError(
				'wrong_secret',
				'That isn’t a valid Recovery Key. Check the 12 words.',
			);
		}
		return secretMemberKeys('recovery', entropy, memberSalt);
	}
	if (!params.kdf_salt || !params.kdf_params) {
		throw new CryptoError('wrong_secret', 'This account has no master password yet.');
	}
	const { pepper } = await api.post<{ pepper: string }>('/v1/account/unlock/pepper');
	const secret = await derivePasswordSecret({
		password: secretText,
		salt: unb64(params.kdf_salt),
		params: params.kdf_params,
		pepper: unb64(pepper),
	});
	try {
		return await secretMemberKeys('password', secret, memberSalt);
	} finally {
		secret.fill(0);
	}
}

/** Proves the secret and returns a keyring acting as the secret member. */
export async function openWithSecret(
	context: UnlockContext,
	method: UnlockMethod,
	secretText: string,
): Promise<Keyring> {
	const params = await fetchUnlockParams();
	const entry = params.members.find((member) => member.kind === method);
	if (!entry?.member_salt)
		throw new CryptoError('wrong_secret', 'This unlock method isn’t set up.');
	const roster = await loadVerifiedRoster(context.accountId, context.browser);
	const rosterMember = roster.members.get(entry.id);
	if (!rosterMember) throw new CryptoError('roster_fork', 'unlock member is not in the roster');

	const keys = await deriveKeys(method, secretText, params, unb64(entry.member_salt));
	if (!sameKey(keys.signPub, rosterMember.signPub)) {
		if (method === 'password') {
			await api.post('/v1/account/unlock/failed').catch(() => undefined);
			throw new CryptoError('wrong_secret', 'Wrong master password.');
		}
		throw new CryptoError('wrong_secret', 'This Recovery Key belongs to a different account.');
	}
	const { key_envelopes } = await api.get<{ key_envelopes: KeyEnvelopeRecord[] }>(
		'/v1/account/unlock/envelopes',
		{ query: { member_id: entry.id } },
	);
	return openKeyring({ id: entry.id, kind: method, keys }, roster, key_envelopes);
}

/** Adds this browser to the roster, signed by the member that just unlocked. */
async function enrollBrowser(keyring: Keyring, browser: StoredBrowserKey): Promise<string> {
	const memberId = crypto.randomUUID();
	const { statement, key_envelopes } = await buildAddMember(
		keyring,
		memberEntry(memberId, 'browser', browser.keys),
	);
	await api.post('/v1/account/browsers/enroll', {
		statements: [statement.input],
		key_envelopes,
	});
	return memberId;
}

async function renewTrust(keyring: Keyring, browser: StoredBrowserKey): Promise<string> {
	if (!browser.memberId) throw new Error('this browser is not a member');
	const jkt = jwkThumbprint(browser.keys.signPub);
	const signature = await sign(
		keyring.member.keys.signKey,
		RENEW_TRUST_CONTEXT,
		utf8(`${browser.memberId}|${jkt}`),
	);
	const { member_id } = await api.post<{ member_id: string }>(
		'/v1/account/browsers/renew-trust',
		{ signer_member_id: keyring.member.id, signature },
	);
	return member_id;
}

export async function unlockBrowser(
	context: UnlockContext,
	method: UnlockMethod,
	secretText: string,
	options: { trust: boolean },
): Promise<void> {
	await completeUnlock(context, await openWithSecret(context, method, secretText), options);
}

/** After any secret member opened the keyring: enroll, renew or keep this browser. */
export async function completeUnlock(
	context: UnlockContext,
	keyring: Keyring,
	options: { trust: boolean },
): Promise<void> {
	let memberId: string;
	if (context.membership === 'expired') memberId = await renewTrust(keyring, context.browser);
	else if (context.membership === 'untrusted' && context.browser.memberId)
		memberId = context.browser.memberId;
	else memberId = await enrollBrowser(keyring, context.browser);
	await updateBrowserKey(context.browser.userId, { memberId, trusted: options.trust });
}
