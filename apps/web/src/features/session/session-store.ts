// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The app-wide session state machine:
 *
 *   loading ─▶ signed_out
 *           ─▶ setup_required   (signed in, account has no roster yet)
 *           ─▶ locked           (signed in, this browser can't open the pouches yet)
 *           ─▶ unlocked         (keyring in memory: content can be decrypted)
 *
 * The keyring (decrypted pouch keys) only ever lives in this module's memory.
 * It is never written to storage; reloading a trusted browser re-opens it
 * from the key envelopes sealed to this browser's key.
 */
import type { Keyring } from '@skillpouch/crypto';
import { useSyncExternalStore } from 'react';
import type { Me } from '@/lib/api/types';
import type { StoredBrowserKey } from '../vault/key-store';

/**
 * Why the pouches are closed: this browser isn't a member yet, its trust
 * window lapsed, or it was never trusted (it opens only after the secret).
 */
export type LockReason = 'new_browser' | 'trust_expired' | 'untrusted';

export type SessionState =
	| { status: 'loading' }
	| { status: 'signed_out'; notice?: string }
	| { status: 'setup_required'; me: Me; browser: StoredBrowserKey }
	| { status: 'locked'; me: Me; browser: StoredBrowserKey; reason: LockReason }
	| { status: 'unlocked'; me: Me; browser: StoredBrowserKey; keyring: Keyring }
	| { status: 'error'; message: string };

let state: SessionState = { status: 'loading' };
const listeners = new Set<() => void>();

export function getSession(): SessionState {
	return state;
}

export function setSession(next: SessionState): void {
	state = next;
	for (const listener of listeners) listener();
}

/** Replaces `me` (after usage or plan changes) without touching the keyring. */
export function patchMe(me: Me): void {
	if ('me' in state && state.me !== me) setSession({ ...state, me } as SessionState);
}

export function subscribeSession(listener: () => void): () => void {
	listeners.add(listener);
	return () => listeners.delete(listener);
}

export function useSession(): SessionState {
	return useSyncExternalStore(subscribeSession, getSession, getSession);
}

/** For components rendered only inside the unlocked app shell. */
export function useUnlocked(): Extract<SessionState, { status: 'unlocked' }> {
	const session = useSession();
	if (session.status !== 'unlocked') throw new Error('useUnlocked outside the unlocked app');
	return session;
}

/** The keyring of the unlocked session (throws when locked). */
export function currentKeyring(): Keyring {
	if (state.status !== 'unlocked') throw new Error('locked');
	return state.keyring;
}
