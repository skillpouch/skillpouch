// SPDX-License-Identifier: AGPL-3.0-only
/** Share links: owner routes (web session) and recipient routes (public or signed in). */
import {
	Empty,
	IdParam,
	Limits,
	PouchParam,
	PublicShare,
	Share,
	ShareClaim,
	ShareCreate,
	ShareList,
} from '@skillpouch/contracts';
import type { Deps } from '../../deps';
import { principalOf, sessionOf } from '../../http/principal';
import type { ZodApp } from '../../http/zod-app';
import {
	claimShare,
	createShare,
	downloadShare,
	getPublicShare,
	listShares,
	recordShareImport,
	revokeShare,
} from './shares.service';

export async function sharesRoutes(app: ZodApp, deps: Deps) {
	app.post(
		'/v1/pouches/:pouchId/shares',
		{
			config: { auth: 'session' },
			bodyLimit: Math.ceil((Limits.shareMaxBytes * 4) / 3) + 16 * 1024,
			schema: {
				tags: ['shares'],
				summary: 'Create a share link for one item (sealed in the browser)',
				params: PouchParam,
				body: ShareCreate,
				response: { 200: Share },
			},
		},
		async (request) =>
			createShare(deps, sessionOf(request), request.params.pouchId, request.body),
	);

	app.get(
		'/v1/shares',
		{
			config: { auth: 'session' },
			schema: {
				tags: ['shares'],
				summary: 'Every share link of the account, newest first',
				response: { 200: ShareList },
			},
		},
		async (request) => listShares(deps, principalOf(request)),
	);

	app.post(
		'/v1/shares/:id/revoke',
		{
			config: { auth: 'session' },
			schema: {
				tags: ['shares'],
				summary: 'Revoke a share link; its ciphertext is deleted',
				params: IdParam,
				response: { 200: Share },
			},
		},
		async (request) => revokeShare(deps, sessionOf(request), request.params.id),
	);

	app.get(
		'/v1/public/shares/:id',
		{
			config: { auth: 'public' },
			schema: {
				tags: ['shares'],
				summary: 'Public: whether a link still works, its size and expiry',
				params: IdParam,
				response: { 200: PublicShare },
			},
		},
		async (request) => getPublicShare(deps, request.params.id),
	);

	app.get(
		'/v1/public/shares/:id/bundle',
		{
			config: { auth: 'public' },
			schema: {
				tags: ['shares'],
				summary: 'Public: sealed bundle of a reusable link (application/octet-stream)',
				params: IdParam,
			},
		},
		async (request, reply) => {
			const bundle = await downloadShare(deps, request.params.id);
			reply.header('Cache-Control', 'no-store');
			return reply.type('application/octet-stream').send(bundle);
		},
	);

	app.post(
		'/v1/shares/:id/claim',
		{
			config: { auth: 'session' },
			schema: {
				tags: ['shares'],
				summary: 'Take the bundle of a one-time link; the link is used up',
				params: IdParam,
				response: { 200: ShareClaim },
			},
		},
		async (request) => claimShare(deps, request.params.id),
	);

	app.post(
		'/v1/shares/:id/imported',
		{
			config: { auth: 'session' },
			schema: {
				tags: ['shares'],
				summary: 'Count an import of a reusable link',
				params: IdParam,
				response: { 200: Empty },
			},
		},
		async (request) => recordShareImport(deps, request.params.id),
	);
}
