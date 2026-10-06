// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Connecting a computer. Two ways in, one approval:
 *
 *  - "Connect CLI" here creates a one-time token for `npx skillpouch login
 *    <token>`; when the CLI uses it, this browser approves automatically.
 *  - `skillpouch login` without a token opens `/cli/authorize`, where the
 *    user compares the confirm code with the terminal and clicks Authorize.
 *
 * Approving adds the CLI's keys to the roster (signed by this browser), seals
 * every pouch key to it, and seals a welcome only that CLI can open.
 */
import { buildAuthorizeCli, cliConfirmCode, jwkThumbprint } from '@skillpouch/crypto';
import { api } from '@/lib/api/client';
import type { CliAuthRequest, ConnectToken, ConnectTokenState } from '@/lib/api/types';
import { currentKeyring } from '../session/session-store';
import { withRosterChange } from '../vault/keyring';

export function createConnectToken(): Promise<ConnectToken> {
	return api.post<ConnectToken>('/v1/cli-auth/connect-tokens');
}

export function connectTokenStatus(id: string): Promise<ConnectTokenState> {
	return api.get<ConnectTokenState>(`/v1/cli-auth/connect-tokens/${id}`);
}

export function cancelConnectToken(id: string): Promise<unknown> {
	return api.delete(`/v1/cli-auth/connect-tokens/${id}`);
}

export function fetchCliRequest(requestId: string): Promise<CliAuthRequest> {
	return api.get<CliAuthRequest>(`/v1/cli-auth/requests/${requestId}`);
}

/** The 8-digit code the terminal shows next to the request (computed, not sent). */
export function confirmCodeOf(request: CliAuthRequest): string {
	return cliConfirmCode({
		requestId: request.request_id,
		signPub: request.sign_pub,
		encPub: request.enc_pub,
	});
}

export async function approveCliRequest(request: CliAuthRequest): Promise<{ deviceId: string }> {
	if (jwkThumbprint(request.sign_pub) !== request.jkt) {
		throw new Error('This request’s keys don’t match. It was not approved.');
	}
	return withRosterChange(async () => {
		const approval = await buildAuthorizeCli(
			currentKeyring(),
			{
				requestId: request.request_id,
				signPub: request.sign_pub,
				encPub: request.enc_pub,
				keyStorage: request.key_storage,
			},
			crypto.randomUUID(),
		);
		const { device_id } = await api.post<{ device_id: string }>(
			`/v1/cli-auth/requests/${request.request_id}/approve`,
			approval,
		);
		return { deviceId: device_id };
	});
}

export function denyCliRequest(requestId: string): Promise<unknown> {
	return api.post(`/v1/cli-auth/requests/${requestId}/deny`);
}
