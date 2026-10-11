// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Fresh sign-in for sensitive actions, without leaving the page.
 *
 * When the API answers `step_up_required`, the request waits while a dialog
 * blocks the page. The user signs in again in a small window; that window
 * lands on `STEP_UP_CALLBACK_PATH`, tells this tab over a same-origin
 * BroadcastChannel and closes. The new session is bound to this browser's key
 * and the request is sent again. The page's state (forms, open dialogs)
 * survives because nothing reloads.
 *
 * The window's handle may lie about being closed once the provider isolates
 * its pages, so a closed window only offers "Try again": a late message from
 * it still finishes the sign-in.
 */
import { useSyncExternalStore } from 'react';
import { api } from '@/lib/api/client';
import { describeError, isApiError } from '@/lib/api/errors';
import { devSignIn, lastProvider, oauthUrl } from '@/lib/auth';
import { readAuthSession } from './auth-session';
import { getSession } from './session-store';

export const STEP_UP_CHANNEL = 'skillpouch.step-up';
export const STEP_UP_CALLBACK_PATH = '/auth/step-up';

export type StepUpMessage = { type: 'signed_in' } | { type: 'cancelled' };

export type StepUpState =
	| { phase: 'idle' }
	/** Waiting for the user to start (opening a window needs their click). */
	| { phase: 'prompt' }
	| { phase: 'waiting' }
	| { phase: 'finishing' }
	| { phase: 'closed' }
	| { phase: 'blocked' }
	| { phase: 'failed'; message: string };

let state: StepUpState = { phase: 'idle' };
const listeners = new Set<() => void>();

function set(next: StepUpState): void {
	state = next;
	for (const listener of listeners) listener();
}

export function getStepUp(): StepUpState {
	return state;
}

function subscribe(listener: () => void): () => void {
	listeners.add(listener);
	return () => listeners.delete(listener);
}

export function useStepUp(): StepUpState {
	return useSyncExternalStore(subscribe, getStepUp, getStepUp);
}

let pending: { promise: Promise<boolean>; resolve: (signedIn: boolean) => void } | null = null;
let popup: Window | null = null;
let channel: BroadcastChannel | null = null;
let poll: ReturnType<typeof setInterval> | null = null;

/**
 * Asks the user to sign in again. Resolves true once they did (same account,
 * session bound), false if they cancelled. Concurrent callers share one prompt.
 */
export function requestStepUp(): Promise<boolean> {
	if (pending) return pending.promise;
	let resolve!: (signedIn: boolean) => void;
	const promise = new Promise<boolean>((done) => (resolve = done));
	pending = { promise, resolve };
	set({ phase: 'prompt' });
	return promise;
}

function stopWatching(): void {
	if (poll) clearInterval(poll);
	poll = null;
	channel?.close();
	channel = null;
}

function settle(signedIn: boolean): void {
	stopWatching();
	popup = null;
	const done = pending;
	pending = null;
	set({ phase: 'idle' });
	done?.resolve(signedIn);
}

export function cancelStepUp(): void {
	popup?.close();
	settle(false);
}

function popupFeatures(): string {
	const width = 520;
	const height = 680;
	const left = Math.max(0, window.screenX + (window.outerWidth - width) / 2);
	const top = Math.max(0, window.screenY + (window.outerHeight - height) / 2);
	return `popup,width=${width},height=${height},left=${left},top=${top}`;
}

/**
 * Opens the sign-in window. Call it straight from a click handler: browsers
 * only allow windows opened by a user gesture, so the window opens blank
 * first and gets the provider's URL once the API returns it.
 */
export function startStepUp(): void {
	if (!pending) return;
	const provider = lastProvider();
	if (typeof provider === 'object') {
		void finish(devSignIn(provider.dev));
		return;
	}
	stopWatching();
	popup = window.open('', 'skillpouch-step-up', popupFeatures());
	if (!popup) {
		set({ phase: 'blocked' });
		return;
	}
	set({ phase: 'waiting' });
	channel = new BroadcastChannel(STEP_UP_CHANNEL);
	channel.onmessage = (event: MessageEvent<StepUpMessage>) => {
		if (event.data?.type === 'signed_in') void finish(Promise.resolve());
		else if (event.data?.type === 'cancelled') {
			stopWatching();
			set({ phase: 'failed', message: 'Sign-in was cancelled.' });
		}
	};
	poll = setInterval(() => {
		if (popup?.closed && state.phase === 'waiting') set({ phase: 'closed' });
	}, 500);
	const target = popup;
	const callback = `${location.origin}${STEP_UP_CALLBACK_PATH}`;
	oauthUrl(provider, callback, `${callback}?error=cancelled`).then(
		(url) => {
			if (!target.closed) target.location.href = url;
		},
		(error: unknown) => {
			target.close();
			stopWatching();
			set({ phase: 'failed', message: describeError(error) });
		},
	);
}

async function finish(signIn: Promise<void>): Promise<void> {
	if (!pending) return;
	stopWatching();
	set({ phase: 'finishing' });
	try {
		await signIn;
		const session = getSession();
		const expected = 'browser' in session ? session.browser.userId : null;
		const auth = await readAuthSession();
		if (!auth) throw new Error('You aren’t signed in. Try again.');
		// Another account signed in: nothing on this page belongs to it.
		if (auth.user.id !== expected) {
			location.reload();
			return;
		}
		// The new session starts unbound; bind it to this browser's key.
		await api.post('/v1/session/bind').catch((error: unknown) => {
			if (!isApiError(error, 'session_already_bound')) throw error;
		});
		settle(true);
	} catch (error) {
		set({ phase: 'failed', message: describeError(error) });
	}
}

/**
 * Runs in the sign-in window when the provider sends it back: reports to the
 * waiting tab and closes. The app itself never starts here.
 */
export function completeStepUpWindow(): void {
	const cancelled = new URLSearchParams(location.search).has('error');
	const message: StepUpMessage = { type: cancelled ? 'cancelled' : 'signed_in' };
	const sender = new BroadcastChannel(STEP_UP_CHANNEL);
	sender.postMessage(message);
	sender.close();
	window.close();
}
