// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Loading the account roster — the signed list of every member that may hold
 * pouch keys. The server stores it but can't forge it: each statement is
 * signed by an existing member and chained to the previous one.
 *
 * This browser pins the genesis hash the first time it verifies the roster
 * and remembers the highest head it saw; a different history or a rollback
 * later is refused, and reported.
 */
import { CryptoError, verifyRoster, type RosterState } from '@skillpouch/crypto';
import { api } from '@/lib/api/client';
import type { MemberRecord, RosterPage } from '@/lib/api/types';
import { updateBrowserKey, type StoredBrowserKey } from './key-store';
import { reportingTamper } from './security-report';

export async function fetchRosterStatements(after = -1): Promise<RosterPage> {
	return api.get<RosterPage>('/v1/account/roster', { query: { after } });
}

export async function fetchMembers(): Promise<MemberRecord[]> {
	return (await api.get<{ members: MemberRecord[] }>('/v1/account/members')).members;
}

/** Verifies the full roster against what this browser pinned before, then advances the pin. */
export async function loadVerifiedRoster(
	accountId: string,
	browser: StoredBrowserKey,
): Promise<RosterState> {
	const page = await fetchRosterStatements();
	const roster = await reportingTamper({ where: 'roster' }, async () => {
		const verified = await verifyRoster(page.statements, {
			accountId,
			...(browser.pinnedGenesisHash ? { pinnedGenesisHash: browser.pinnedGenesisHash } : {}),
		});
		if (verified.headSeq < browser.pinnedHeadSeq) {
			throw new CryptoError('roster_rollback', 'the server returned an older roster');
		}
		const pinned = browser.pinnedHeadHash;
		if (pinned && verified.heads.get(pinned) !== browser.pinnedHeadSeq) {
			throw new CryptoError(
				'roster_fork',
				`roster #${browser.pinnedHeadSeq} changed after this browser saw it`,
			);
		}
		return verified;
	});
	if (
		roster.genesisHash !== browser.pinnedGenesisHash ||
		roster.headSeq !== browser.pinnedHeadSeq ||
		roster.headHash !== browser.pinnedHeadHash
	) {
		await updateBrowserKey(browser.userId, {
			pinnedGenesisHash: roster.genesisHash,
			pinnedHeadSeq: roster.headSeq,
			pinnedHeadHash: roster.headHash,
		});
		browser.pinnedGenesisHash = roster.genesisHash;
		browser.pinnedHeadSeq = roster.headSeq;
		browser.pinnedHeadHash = roster.headHash;
	}
	return roster;
}
