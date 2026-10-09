// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Better Auth's session check. Signed out is `200 null`; anything else that
 * is not a 2xx means the server could not answer (restarting, deploying,
 * offline) and must never be mistaken for signed out — that would drop the
 * user on the sign-in page of a perfectly good session.
 */

export interface AuthSession {
	user: { id: string; email: string };
}

/** Waits between attempts while the server is unreachable. */
export const RETRY_DELAYS_MS = [500, 1500, 3000];

export class SessionCheckFailed extends Error {
	constructor() {
		super('The SkillPouch server isn’t answering right now. Try again in a moment.');
		this.name = 'SessionCheckFailed';
	}
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export async function readAuthSession(
	fetcher: typeof fetch = fetch,
	wait: (ms: number) => Promise<void> = sleep,
): Promise<AuthSession | null> {
	for (let attempt = 0; ; attempt++) {
		const response = await fetcher('/v1/auth/get-session', {
			credentials: 'same-origin',
		}).catch(() => null);
		if (response?.ok) {
			const body = (await response.json().catch(() => null)) as AuthSession | null;
			return body?.user ? body : null;
		}
		if (response?.status === 401) return null;
		const delay = RETRY_DELAYS_MS[attempt];
		if (delay === undefined) throw new SessionCheckFailed();
		await wait(delay);
	}
}
