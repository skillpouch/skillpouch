// SPDX-License-Identifier: AGPL-3.0-only
/** "Authorize CLI" routes (plan 08 §6, 06 §3). */
import {
	CliAuthApprove,
	CliAuthCreate,
	CliAuthCreated,
	CliAuthRequestView,
	CliAuthTokenRequest,
	CliAuthTokenResponse,
	Empty,
	IdParam,
} from '@skillpouch/contracts';
import { z } from 'zod';
import type { Deps } from '../../deps';
import { sessionOf } from '../../http/principal';
import type { ZodApp } from '../../http/zod-app';
import { clientIpHash, verifyRequestDpop } from '../../security/authenticate';
import {
	approveCliAuthRequest,
	cancelCliAuthRequest,
	createCliAuthRequest,
	denyCliAuthRequest,
	getCliAuthRequest,
	redeemCliAuthRequest,
} from './cli-auth.service';

export async function cliAuthRoutes(app: ZodApp, deps: Deps) {
	app.post(
		'/v1/cli-auth/requests',
		{
			config: { auth: 'public', rateLimit: 'auth' },
			schema: {
				tags: ['cli-auth'],
				summary: 'CLI starts login (DPoP proof signed by sign_pub required)',
				body: CliAuthCreate,
				response: { 200: CliAuthCreated },
			},
		},
		async (request) => {
			const proof = await verifyRequestDpop(deps, request);
			return createCliAuthRequest(deps, request.body, proof.jkt, clientIpHash(deps, request));
		},
	);

	app.get(
		'/v1/cli-auth/requests/:id',
		{
			config: { auth: 'session' },
			schema: {
				tags: ['cli-auth'],
				summary: 'Authorize page loads the request (device, keys, location)',
				params: IdParam,
				response: { 200: CliAuthRequestView },
			},
		},
		async (request) => getCliAuthRequest(deps, sessionOf(request), request.params.id),
	);

	app.post(
		'/v1/cli-auth/requests/:id/approve',
		{
			config: { auth: 'session' },
			schema: {
				tags: ['cli-auth'],
				summary: 'Authorize: roster add + sealed welcome + key envelopes; creates the device',
				params: IdParam,
				body: CliAuthApprove,
				response: { 200: z.object({ device_id: z.uuid() }) },
			},
		},
		async (request) =>
			approveCliAuthRequest(deps, sessionOf(request), request.params.id, request.body, clientIpHash(deps, request)),
	);

	app.post(
		'/v1/cli-auth/requests/:id/deny',
		{
			config: { auth: 'session' },
			schema: { tags: ['cli-auth'], params: IdParam, response: { 200: Empty } },
		},
		async (request) => denyCliAuthRequest(deps, sessionOf(request), request.params.id),
	);

	app.post(
		'/v1/cli-auth/token',
		{
			config: { auth: 'public', rateLimit: 'auth' },
			schema: {
				tags: ['cli-auth'],
				summary: 'CLI redeems the approved request (PKCE verifier + same DPoP key); long-polls up to `wait` s',
				body: CliAuthTokenRequest,
				response: { 200: CliAuthTokenResponse },
			},
		},
		async (request) => {
			const proof = await verifyRequestDpop(deps, request);
			const controller = new AbortController();
			request.raw.once('close', () => controller.abort());
			return redeemCliAuthRequest(deps, request.body, proof.jkt, controller.signal);
		},
	);

	app.delete(
		'/v1/cli-auth/requests/:id',
		{
			config: { auth: 'public' },
			schema: { tags: ['cli-auth'], summary: 'CLI cancels its pending request', params: IdParam, response: { 200: Empty } },
		},
		async (request) => {
			const proof = await verifyRequestDpop(deps, request);
			return cancelCliAuthRequest(deps, request.params.id, proof.jkt);
		},
	);
}
