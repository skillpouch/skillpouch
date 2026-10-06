// SPDX-License-Identifier: AGPL-3.0-only
import type { FastifyRequest } from 'fastify';
import type { DevicePrincipal, Principal, SessionPrincipal } from '../security/principal';
import { AppError } from './app-error';

/** The authenticated caller; routes with `auth !== 'public'` always have one. */
export function principalOf(request: FastifyRequest): Principal {
	if (!request.principal) throw new AppError('unauthenticated');
	return request.principal;
}

export function sessionOf(request: FastifyRequest): SessionPrincipal {
	const principal = principalOf(request);
	if (principal.kind !== 'session')
		throw new AppError('forbidden', { reason: 'browser session required' });
	return principal;
}

export function deviceOf(request: FastifyRequest): DevicePrincipal {
	const principal = principalOf(request);
	if (principal.kind !== 'device')
		throw new AppError('forbidden', { reason: 'CLI device required' });
	return principal;
}

/** The caller's roster member id — required for anything that signs E2EE data. */
export function memberOf(principal: Principal): string {
	if (!principal.memberId)
		throw new AppError('member_inactive', { reason: 'this client is not enrolled' });
	return principal.memberId;
}
