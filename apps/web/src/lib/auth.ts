// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Web sign-in through Better Auth (GitHub / Google OAuth). Sign-in only
 * proves who you are; opening your pouches still needs this browser's key or
 * an unlock secret.
 */
export type OAuthProvider = 'github' | 'google';

async function authPost(path: string, body: unknown): Promise<Response> {
	return fetch(`/v1/auth/${path}`, {
		method: 'POST',
		credentials: 'same-origin',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify(body),
	});
}

/** The provider's sign-in URL; the provider sends the user back to `callbackURL`. */
export async function oauthUrl(
	provider: OAuthProvider,
	callbackURL: string,
	errorCallbackURL: string,
): Promise<string> {
	const response = await authPost('sign-in/social', {
		provider,
		callbackURL,
		errorCallbackURL,
		disableRedirect: true,
	});
	const body = (await response.json().catch(() => null)) as { url?: string } | null;
	if (!response.ok || !body?.url) throw new Error('Sign-in isn’t available right now.');
	return body.url;
}

/** Starts the OAuth redirect. `redirect` is an in-app path to return to. */
export async function startOAuth(provider: OAuthProvider, redirect: string): Promise<void> {
	const origin = location.origin;
	location.assign(
		await oauthUrl(
			provider,
			`${origin}${safeRedirect(redirect)}`,
			`${origin}/sign-in?error=cancelled`,
		),
	);
}

/** Links another provider to the signed-in user, so either one signs in. */
export async function linkAccount(provider: OAuthProvider, redirect: string): Promise<void> {
	const origin = location.origin;
	const target = `${origin}${safeRedirect(redirect)}`;
	const response = await authPost('link-social', {
		provider,
		callbackURL: target,
		errorCallbackURL: `${target}${target.includes('?') ? '&' : '?'}link=failed`,
		disableRedirect: true,
	});
	const body = (await response.json().catch(() => null)) as { url?: string } | null;
	if (!response.ok || !body?.url) throw new Error('Linking isn’t available right now.');
	location.assign(body.url);
}

export interface LinkedAccount {
	providerId: string;
	accountId: string;
}

export async function listLinkedAccounts(): Promise<LinkedAccount[]> {
	const response = await fetch('/v1/auth/list-accounts', { credentials: 'same-origin' });
	if (!response.ok) throw new Error('Couldn’t load your sign-in methods.');
	return (await response.json()) as LinkedAccount[];
}

export async function unlinkAccount(provider: OAuthProvider): Promise<void> {
	const response = await authPost('unlink-account', { providerId: provider });
	if (!response.ok) {
		const body = (await response.json().catch(() => null)) as { message?: string } | null;
		throw new Error(body?.message ?? 'Couldn’t unlink this account.');
	}
}

/** Development only: the API exposes `/v1/dev/login` when `DEV_LOGIN=true`. */
export async function devSignIn(email: string): Promise<void> {
	const response = await fetch('/v1/dev/login', {
		method: 'POST',
		credentials: 'same-origin',
		headers: { 'content-type': 'application/json', 'skillpouch-client': 'web/dev' },
		body: JSON.stringify({ email }),
	});
	if (!response.ok) throw new Error('Dev sign-in is not enabled on this API.');
}

/**
 * A fresh OAuth round trip in this tab, for when the browser blocks the
 * sign-in window. Returns to the current page afterwards.
 */
export async function reauthenticate(): Promise<void> {
	const last = lastProvider();
	if (typeof last === 'object') {
		await devSignIn(last.dev);
		location.reload();
		return;
	}
	await startOAuth(last, `${location.pathname}${location.search}`);
}

const PROVIDER_KEY = 'skillpouch.provider';

/** How the user last signed in: an OAuth provider (GitHub by default) or a dev email. */
export function lastProvider(): OAuthProvider | { dev: string } {
	const last = localStorage.getItem(PROVIDER_KEY);
	if (last?.startsWith('dev:')) return { dev: last.slice(4) };
	return last === 'google' ? 'google' : 'github';
}

/** Remembers how the user signed in, so a re-authentication uses the same provider. */
export function rememberProvider(provider: OAuthProvider | `dev:${string}`): void {
	localStorage.setItem(PROVIDER_KEY, provider);
}

/** The email of the last development sign-in, so the dev form offers the same account. */
export function lastDevEmail(): string | null {
	const last = localStorage.getItem(PROVIDER_KEY);
	return last?.startsWith('dev:') ? last.slice(4) : null;
}

/** Only same-app paths; never an absolute URL (open-redirect protection). */
export function safeRedirect(value: string | null | undefined): string {
	if (!value || !value.startsWith('/') || value.startsWith('//') || value.includes('\\')) {
		return '/app';
	}
	return value;
}
