// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Account genesis, run once at the end of web onboarding:
 *
 *   prepare  → server hands out a fresh Argon2id salt and the unlock pepper
 *   derive   → master password → password member keys (in a worker)
 *   build    → roster #0 (this browser + password + Recovery Key members) and
 *              #1 (the first pouch), plus that pouch's key envelopes
 *   commit   → `POST /v1/account/roster/genesis`
 *
 * Nothing secret leaves the browser: the server stores public keys,
 * signatures and sealed envelopes only.
 */
import { buildGenesis, unb64, type RecoveryKey } from '@skillpouch/crypto';
import { api } from '@/lib/api/client';
import type { UnlockPreparedRecord } from '@/lib/api/types';
import { updateBrowserKey, type StoredBrowserKey } from './key-store';
import { derivePasswordSecret } from './password';

export interface GenesisInput {
	accountId: string;
	browser: StoredBrowserKey;
	password: string;
	recoveryKey: RecoveryKey;
	trustBrowser: boolean;
	firstPouchName?: string;
}

export async function createAccountVault(input: GenesisInput): Promise<void> {
	const prepared = await api.post<UnlockPreparedRecord>('/v1/account/unlock/prepare');
	const secret = await derivePasswordSecret({
		password: input.password,
		salt: unb64(prepared.kdf_salt),
		params: prepared.kdf_params,
		pepper: unb64(prepared.pepper),
	});
	const browserMemberId = crypto.randomUUID();
	const genesis = await buildGenesis({
		accountId: input.accountId,
		browserMemberId,
		browserKeys: input.browser.keys,
		passwordSecret: secret,
		passwordMemberId: crypto.randomUUID(),
		recoveryEntropy: input.recoveryKey.entropy,
		recoveryMemberId: crypto.randomUUID(),
		pouchId: crypto.randomUUID(),
		pouch: { name: input.firstPouchName ?? 'Personal', description: '' },
	});
	secret.fill(0);
	await api.post('/v1/account/roster/genesis', genesis.request);
	await updateBrowserKey(input.browser.userId, {
		memberId: browserMemberId,
		trusted: input.trustBrowser,
		pinnedGenesisHash: genesis.genesisHash,
		pinnedHeadSeq: genesis.keyring.roster.headSeq,
	});
}

/** The Recovery Key as a downloadable text file. */
export function recoveryKeyFile(words: string[], email: string): Blob {
	const lines = [
		'SkillPouch Recovery Key',
		'',
		`Account: ${email}`,
		`Created: ${new Date().toISOString().slice(0, 10)}`,
		'',
		words.map((word, index) => `${String(index + 1).padStart(2, ' ')}. ${word}`).join('\n'),
		'',
		'This key opens your pouches if you forget your master password.',
		'Keep it offline. Anyone with it and your sign-in can read your pouches.',
		'',
	];
	return new Blob([lines.join('\n')], { type: 'text/plain' });
}
