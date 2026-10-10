// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Startup: work out who is signed in and whether this browser can open the
 * pouches, then publish the result to the session store.
 *
 *  1. Ask Better Auth for the session (cookie only) → user id, or signed out.
 *  2. Load this user's browser key from IndexedDB, or create one.
 *  3. Bind the web session to that key (first time only). From then on every
 *     request must carry a DPoP proof from it.
 *  4. No roster yet → onboarding. Otherwise verify the roster; if this key is
 *     an active member, open its key envelopes → unlocked. If not → locked.
 */
import {
	generateMemberKeyPair,
	isActive,
	openKeyring,
	sameKey,
	type MemberState,
	type RosterState,
} from '@skillpouch/crypto';
import { api, setDpopKey } from '@/lib/api/client';
import { isApiError } from '@/lib/api/errors';
import { queryClient } from '@/lib/query-client';
import type { KeyEnvelopeRecord, Me } from '@/lib/api/types';
import {
	deleteBrowserKey,
	loadBrowserKey,
	saveBrowserKey,
	updateBrowserKey,
	type StoredBrowserKey,
} from '../vault/key-store';
import { fetchMembers, loadVerifiedRoster } from '../vault/roster';
import { readAuthSession } from './auth-session';
import { getSession, setSession, type SessionState } from './session-store';

async function loadOrCreateKey(userId: string): Promise<StoredBrowserKey> {
	const existing = await loadBrowserKey(userId);
	if (existing) return existing;
	const record: StoredBrowserKey = {
		userId,
		keys: await generateMemberKeyPair(),
		memberId: null,
		trusted: true,
		pinnedGenesisHash: null,
		pinnedHeadSeq: -1,
		createdAt: new Date().toISOString(),
	};
	await saveBrowserKey(record);
	return record;
}

/** The roster member this browser's key is, if any. */
export function findBrowserMember(
	roster: RosterState,
	browser: StoredBrowserKey,
): MemberState | null {
	for (const member of roster.members.values()) {
		if (member.kind === 'browser' && sameKey(member.signPub, browser.keys.signPub)) {
			return member;
		}
	}
	return null;
}

/** Opens the keyring of this browser's member from its key envelopes. */
export async function openBrowserKeyring(
	roster: RosterState,
	browser: StoredBrowserKey,
	member: MemberState,
) {
	const { key_envelopes } = await api.get<{ key_envelopes: KeyEnvelopeRecord[] }>(
		'/v1/account/key-envelopes',
	);
	return openKeyring(
		{ id: member.id, kind: 'browser', keys: browser.keys },
		roster,
		key_envelopes,
	);
}

export interface BootstrapOptions {
	/**
	 * The secret was proven on this page a moment ago (setup or unlock), so an
	 * untrusted browser may open its pouches until the page is reloaded.
	 */
	secretProven?: boolean;
}

/** User whose secret was proven in this page; memory only, gone on reload. */
let provenUser: string | null = null;

async function resolve(options: BootstrapOptions): Promise<SessionState> {
	const auth = await readAuthSession();
	if (!auth) return { status: 'signed_out' };

	if (options.secretProven) provenUser = auth.user.id;
	let browser = await loadOrCreateKey(auth.user.id);
	setDpopKey(browser.keys);

	let me: Me;
	try {
		me = await api.get<Me>('/v1/me');
	} catch (error) {
		// The session was bound to a key this browser no longer has (site data
		// cleared, another profile): the cookie is unusable. Start over.
		if (isApiError(error, 'dpop_invalid') || isApiError(error, 'device_revoked')) {
			await signOutQuietly(auth.user.id);
			return {
				status: 'signed_out',
				notice: isApiError(error, 'device_revoked')
					? 'This browser was removed from your account. Sign in again.'
					: 'Your session ended. Sign in again.',
			};
		}
		throw error;
	}
	if (me.session && !me.session.bound) {
		await api.post('/v1/session/bind');
	}

	if (!me.account.roster_initialized) return { status: 'setup_required', me, browser };

	const roster = await loadVerifiedRoster(me.account.id, browser);
	const member = findBrowserMember(roster, browser);
	if (!member || !isActive(member)) {
		if (browser.memberId)
			browser = (await updateBrowserKey(browser.userId, { memberId: null }))!;
		return { status: 'locked', me, browser, reason: 'new_browser' };
	}
	const record = (await fetchMembers()).find((entry) => entry.id === member.id);
	if (record?.trust_expired_at) {
		return { status: 'locked', me, browser, reason: 'trust_expired' };
	}
	if (browser.memberId !== member.id) {
		browser = (await updateBrowserKey(browser.userId, { memberId: member.id }))!;
	}
	// An untrusted browser keeps its key only so the bound session survives a
	// reload; the pouches stay closed until the secret is proven again.
	if (!browser.trusted && provenUser !== auth.user.id)
		return { status: 'locked', me, browser, reason: 'untrusted' };
	const keyring = await openBrowserKeyring(roster, browser, member);
	return { status: 'unlocked', me, browser, keyring };
}

/** Runs (or re-runs) the startup sequence and publishes the result. */
export async function bootstrapSession(options: BootstrapOptions = {}): Promise<SessionState> {
	let next: SessionState;
	try {
		next = await resolve(options);
	} catch (error) {
		next = {
			status: 'error',
			message: error instanceof Error ? error.message : 'Could not load your account.',
		};
	}
	// Keep the reason a user was just signed out (e.g. revoked) when a late
	// re-run finds the same signed-out state without one.
	const current = getSession();
	if (
		next.status === 'signed_out' &&
		!next.notice &&
		current.status === 'signed_out' &&
		current.notice
	) {
		next = current;
	}
	setSession(next);
	return next;
}

async function signOutQuietly(userId: string): Promise<void> {
	provenUser = null;
	setDpopKey(null);
	await deleteBrowserKey(userId);
	await fetch('/v1/auth/sign-out', {
		method: 'POST',
		credentials: 'same-origin',
		headers: { 'content-type': 'application/json', 'skillpouch-client': 'web' },
		body: '{}',
	}).catch(() => undefined);
}

/**
 * This browser was revoked from another device: its session is already gone
 * on the server, so forget the key and show why the user is signed out.
 */
export async function endRevokedBrowser(state: SessionState): Promise<void> {
	if ('browser' in state) await signOutQuietly(state.browser.userId);
	setSession({
		status: 'signed_out',
		notice: 'This browser was removed from your account. Sign in again.',
	});
}

/**
 * Sign out. An untrusted browser also removes itself from the account first,
 * so nothing that could open the pouches is left behind.
 */
export async function signOut(state: SessionState): Promise<void> {
	provenUser = null;
	if ('browser' in state) {
		const { browser } = state;
		if (!browser.trusted && browser.memberId) {
			await api.post(`/v1/browsers/${browser.memberId}/revoke`, {}).catch(() => undefined);
			await deleteBrowserKey(browser.userId);
		}
	}
	setDpopKey(null);
	await fetch('/v1/auth/sign-out', {
		method: 'POST',
		credentials: 'same-origin',
		headers: { 'content-type': 'application/json', 'skillpouch-client': 'web' },
		body: '{}',
	}).catch(() => undefined);
	setSession({ status: 'signed_out' });
	// Nothing of this account may show up for the next one to sign in.
	queryClient.clear();
}
