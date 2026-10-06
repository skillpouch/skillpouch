// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Keeping the in-memory keyring in step with the account: after this browser
 * changes the roster, or another device does (`roster.changed`), the roster
 * is verified again and the key envelopes re-opened.
 */
import type { Keyring } from '@skillpouch/crypto';
import { findBrowserMember, openBrowserKeyring } from '../session/bootstrap';
import { getSession, setSession } from '../session/session-store';
import { loadVerifiedRoster } from './roster';

let inFlight: Promise<Keyring | null> | null = null;

/** Re-verifies the roster and reopens this browser's keyring (deduplicated). */
export function reloadKeyring(): Promise<Keyring | null> {
	inFlight ??= (async () => {
		try {
			const session = getSession();
			if (session.status !== 'unlocked') return null;
			const roster = await loadVerifiedRoster(session.me.account.id, session.browser);
			const member = findBrowserMember(roster, session.browser);
			if (!member || member.removedSeq !== null) {
				setSession({
					status: 'locked',
					me: session.me,
					browser: session.browser,
					reason: 'new_browser',
				});
				return null;
			}
			const keyring = await openBrowserKeyring(roster, session.browser, member);
			const latest = getSession();
			if (latest.status === 'unlocked') setSession({ ...latest, keyring });
			return keyring;
		} finally {
			inFlight = null;
		}
	})();
	return inFlight;
}

/**
 * Runs a roster-changing request. The builders advance the in-memory roster
 * optimistically; if the server refuses, the keyring is reloaded so memory
 * never drifts from what the server holds.
 */
export async function withRosterChange<T>(run: () => Promise<T>): Promise<T> {
	try {
		return await run();
	} catch (error) {
		await reloadKeyring().catch(() => undefined);
		throw error;
	}
}
