// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Who is calling. The tenant (`storageAccountId`) always comes
 * from the authenticated credential, never from the request.
 */
export interface DevicePrincipal {
	kind: 'device';
	userId: string;
	storageAccountId: string;
	deviceId: string;
	/** The device's roster member, once enrolled. */
	memberId: string | null;
	/** Thumbprint of the device key that signed this request's DPoP proof. */
	jkt: string;
	publicJwk: Record<string, string>;
}

export interface SessionPrincipal {
	kind: 'session';
	userId: string;
	email: string;
	role: 'user' | 'admin';
	storageAccountId: string;
	sessionId: string;
	/** Bound browser key thumbprint; null until `POST /v1/session/bind`. */
	jkt: string | null;
	/** The browser's roster member, if this browser is enrolled. */
	memberId: string | null;
	/** Set when this browser's member exists but its trust window lapsed. */
	trustExpiredMemberId: string | null;
	stepUpAt: Date | null;
}

export type Principal = DevicePrincipal | SessionPrincipal;

export function principalLabel(principal: Principal): string {
	return principal.kind === 'device'
		? `device:${principal.deviceId}`
		: `user:${principal.userId}`;
}
