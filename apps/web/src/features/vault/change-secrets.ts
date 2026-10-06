// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Replacing the master password or the Recovery Key from an unlocked
 * browser. Either way the old member is removed and every pouch key rotated,
 * so the old secret opens nothing written afterwards.
 */
import {
	b64,
	buildReplaceSecretMember,
	generateRecoveryKey,
	memberEntry,
	newMemberSalt,
	secretMemberKeys,
	unb64,
	type RecoveryKey,
} from '@skillpouch/crypto';
import { api } from '@/lib/api/client';
import type { UnlockPreparedRecord } from '@/lib/api/types';
import { currentKeyring } from '../session/session-store';
import { reloadKeyring, withRosterChange } from './keyring';
import { derivePasswordSecret } from './password';

function activeMemberOfKind(kind: 'password' | 'recovery'): string {
	const member = [...currentKeyring().roster.members.values()].find(
		(candidate) => candidate.kind === kind && candidate.removedSeq === null,
	);
	if (!member) throw new Error(`no active ${kind} member`);
	return member.id;
}

export async function changeMasterPassword(password: string): Promise<void> {
	await withRosterChange(async () => {
		const prepared = await api.post<UnlockPreparedRecord>('/v1/account/unlock/prepare');
		const secret = await derivePasswordSecret({
			password,
			salt: unb64(prepared.kdf_salt),
			params: prepared.kdf_params,
			pepper: unb64(prepared.pepper),
		});
		const salt = newMemberSalt();
		const keys = await secretMemberKeys('password', secret, salt);
		secret.fill(0);
		const change = await buildReplaceSecretMember(
			currentKeyring(),
			activeMemberOfKind('password'),
			memberEntry(crypto.randomUUID(), 'password', keys, { memberSalt: b64(salt) }),
		);
		await api.put('/v1/account/unlock', change);
		await reloadKeyring();
	});
}

export function newRecoveryKey(): RecoveryKey {
	return generateRecoveryKey();
}

export async function replaceRecoveryKey(recoveryKey: RecoveryKey): Promise<void> {
	await withRosterChange(async () => {
		const salt = newMemberSalt();
		const keys = await secretMemberKeys('recovery', recoveryKey.entropy, salt);
		const change = await buildReplaceSecretMember(
			currentKeyring(),
			activeMemberOfKind('recovery'),
			memberEntry(crypto.randomUUID(), 'recovery', keys, { memberSalt: b64(salt) }),
		);
		await api.post('/v1/account/roster', change);
		await reloadKeyring();
	});
}
