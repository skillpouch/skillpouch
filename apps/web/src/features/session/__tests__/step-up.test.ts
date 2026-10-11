// SPDX-License-Identifier: AGPL-3.0-only
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, setStepUpHandler } from '@/lib/api/client';
import { rememberProvider } from '@/lib/auth';
import { setSession, type SessionState } from '../session-store';
import {
	cancelStepUp,
	completeStepUpWindow,
	getStepUp,
	requestStepUp,
	startStepUp,
	STEP_UP_CHANNEL,
	type StepUpMessage,
} from '../step-up';

interface Call {
	method: string;
	path: string;
}

const jsonResponse = (status: number, body: unknown) =>
	new Response(JSON.stringify(body), {
		status,
		headers: { 'content-type': 'application/json' },
	});

let calls: Call[];
let signedInAs: string;
let deleteNeedsStepUp: boolean;

function fakeFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
	const path = String(input);
	const method = init?.method ?? 'GET';
	calls.push({ method, path });
	if (path === '/v1/auth/sign-in/social') {
		return Promise.resolve(jsonResponse(200, { url: 'https://github.com/login/oauth' }));
	}
	if (path === '/v1/auth/get-session') {
		return Promise.resolve(jsonResponse(200, { user: { id: signedInAs, email: 'a@b.c' } }));
	}
	if (path === '/v1/dev/login') return Promise.resolve(jsonResponse(200, {}));
	if (path === '/v1/session/bind') {
		deleteNeedsStepUp = false;
		return Promise.resolve(jsonResponse(200, { ok: true, data: {} }));
	}
	if (path === '/v1/pouches/p1' && method === 'DELETE') {
		if (deleteNeedsStepUp) {
			return Promise.resolve(
				jsonResponse(403, {
					ok: false,
					error: { code: 'step_up_required', message: 'Sign in again.' },
				}),
			);
		}
		return Promise.resolve(jsonResponse(200, { ok: true, data: { deleted: true } }));
	}
	return Promise.resolve(jsonResponse(404, {}));
}

function fakePopup() {
	return { closed: false, close: vi.fn(), location: { href: '' } };
}

async function announce(message: StepUpMessage): Promise<void> {
	const sender = new BroadcastChannel(STEP_UP_CHANNEL);
	sender.postMessage(message);
	sender.close();
}

const until = (check: () => boolean) => vi.waitFor(() => expect(check()).toBe(true));

beforeEach(() => {
	calls = [];
	signedInAs = 'user-1';
	deleteNeedsStepUp = true;
	vi.stubGlobal('fetch', vi.fn(fakeFetch));
	setSession({
		status: 'unlocked',
		browser: { userId: 'user-1' },
	} as unknown as SessionState);
	rememberProvider('github');
	setStepUpHandler(requestStepUp);
});

afterEach(() => {
	cancelStepUp();
	setStepUpHandler(null);
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
	localStorage.clear();
});

describe('step-up sign-in', () => {
	it('waits for the sign-in window, binds the new session and retries the request', async () => {
		const popup = fakePopup();
		const open = vi.spyOn(window, 'open').mockReturnValue(popup as unknown as Window);

		const deletion = api.delete<{ deleted: boolean }>('/v1/pouches/p1');
		await until(() => getStepUp().phase === 'prompt');
		startStepUp();
		expect(open).toHaveBeenCalledOnce();
		expect(getStepUp().phase).toBe('waiting');
		await until(() => popup.location.href === 'https://github.com/login/oauth');

		await announce({ type: 'signed_in' });

		await expect(deletion).resolves.toEqual({ deleted: true });
		expect(getStepUp().phase).toBe('idle');
		expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual([
			'DELETE /v1/pouches/p1',
			'POST /v1/auth/sign-in/social',
			'GET /v1/auth/get-session',
			'POST /v1/session/bind',
			'DELETE /v1/pouches/p1',
		]);
	});

	it('shares one prompt between requests that need it at the same time', async () => {
		const first = requestStepUp();
		const second = requestStepUp();
		expect(second).toBe(first);
	});

	it('fails the request with step_up_required when the user cancels', async () => {
		const deletion = api.delete('/v1/pouches/p1');
		await until(() => getStepUp().phase === 'prompt');
		cancelStepUp();
		await expect(deletion).rejects.toMatchObject({ code: 'step_up_required' });
		expect(calls.filter((call) => call.path === '/v1/pouches/p1')).toHaveLength(1);
	});

	it('offers signing in in this tab when the browser blocks the window', () => {
		vi.spyOn(window, 'open').mockReturnValue(null);
		void requestStepUp();
		startStepUp();
		expect(getStepUp().phase).toBe('blocked');
	});

	it('offers trying again when the window was closed, and still finishes on a late message', async () => {
		vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
		const popup = fakePopup();
		vi.spyOn(window, 'open').mockReturnValue(popup as unknown as Window);
		const result = requestStepUp();
		startStepUp();
		popup.closed = true;
		vi.advanceTimersByTime(600);
		expect(getStepUp().phase).toBe('closed');
		vi.useRealTimers();
		expect(getStepUp().phase).toBe('closed');
		// "Try again" opens a fresh window; a late message from it still counts.
		startStepUp();
		await announce({ type: 'signed_in' });
		await expect(result).resolves.toBe(true);
	});

	it('reports a cancelled sign-in from the provider', async () => {
		vi.spyOn(window, 'open').mockReturnValue(fakePopup() as unknown as Window);
		void requestStepUp();
		startStepUp();
		await announce({ type: 'cancelled' });
		await until(() => getStepUp().phase === 'failed');
	});

	it('reloads instead of continuing when another account signed in', async () => {
		signedInAs = 'user-2';
		const reload = vi.fn();
		vi.stubGlobal('location', { ...location, origin: location.origin, reload });
		vi.spyOn(window, 'open').mockReturnValue(fakePopup() as unknown as Window);
		void requestStepUp();
		startStepUp();
		await announce({ type: 'signed_in' });
		await until(() => reload.mock.calls.length === 1);
		expect(calls.some((call) => call.path === '/v1/session/bind')).toBe(false);
	});

	it('signs in a dev account directly, without a window', async () => {
		rememberProvider('dev:dev@example.com');
		const open = vi.spyOn(window, 'open');
		const result = requestStepUp();
		startStepUp();
		await expect(result).resolves.toBe(true);
		expect(open).not.toHaveBeenCalled();
		expect(calls.map((call) => call.path)).toContain('/v1/dev/login');
	});

	it('the sign-in window reports back and closes', async () => {
		const close = vi.spyOn(window, 'close').mockImplementation(() => undefined);
		const receiver = new BroadcastChannel(STEP_UP_CHANNEL);
		const received = new Promise<StepUpMessage>((resolve) => {
			receiver.onmessage = (event: MessageEvent<StepUpMessage>) => resolve(event.data);
		});
		completeStepUpWindow();
		await expect(received).resolves.toEqual({ type: 'signed_in' });
		receiver.close();
		expect(close).toHaveBeenCalledOnce();
	});
});
