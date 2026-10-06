// SPDX-License-Identifier: AGPL-3.0-only
/** Blob routes. Bodies are client-encrypted ciphertext. */
import {
	BlobBatchResponse,
	BlobCheckRequest,
	BlobCheckResponse,
	BlobFetchRequest,
	BlobId,
	BlobPutResponse,
	Limits,
	PouchParam,
	toBase64Url,
} from '@skillpouch/contracts';
import { z } from 'zod';
import type { Deps } from '../../deps';
import { AppError } from '../../http/app-error';
import { principalOf } from '../../http/principal';
import type { ZodApp } from '../../http/zod-app';
import {
	checkBlobs,
	encodeDownloadFrames,
	getBlob,
	parseUploadFrames,
	putBlob,
} from './blobs.service';

const BlobParams = PouchParam.extend({ blobId: BlobId });

function bodyBuffer(body: unknown): Buffer {
	if (!Buffer.isBuffer(body))
		throw new AppError('validation_failed', { reason: 'expected application/octet-stream' });
	return body;
}

export async function blobsRoutes(app: ZodApp, deps: Deps) {
	app.post(
		'/v1/pouches/:pouchId/blobs/check',
		{
			config: { auth: 'any', rateLimit: 'blobs' },
			schema: {
				tags: ['sync'],
				summary: 'Which blobs are missing; reserves quota for them',
				params: PouchParam,
				body: BlobCheckRequest,
				response: { 200: BlobCheckResponse },
			},
		},
		async (request) =>
			checkBlobs(deps, principalOf(request), request.params.pouchId, request.body.blobs),
	);

	app.put(
		'/v1/pouches/:pouchId/blobs/:blobId',
		{
			config: { auth: 'any', rateLimit: 'blobs' },
			bodyLimit: Limits.blobMaxStoredBytes + 1,
			schema: {
				tags: ['sync'],
				summary: 'Upload one sealed blob (raw body, Skillpouch-Ciphertext-Hash header)',
				params: BlobParams,
				response: { 200: BlobPutResponse },
			},
		},
		async (request) => {
			const header = request.headers['skillpouch-ciphertext-hash'];
			return putBlob(
				deps,
				principalOf(request),
				request.params.pouchId,
				request.params.blobId,
				bodyBuffer(request.body),
				typeof header === 'string' ? header : undefined,
			);
		},
	);

	app.get(
		'/v1/pouches/:pouchId/blobs/:blobId',
		{
			config: { auth: 'any', rateLimit: 'blobs', raw: true },
			schema: {
				tags: ['sync'],
				summary: 'Download one sealed blob (application/octet-stream)',
				params: BlobParams,
			},
		},
		async (request, reply) => {
			const { bytes, ciphertextHash } = await getBlob(
				deps,
				principalOf(request),
				request.params.pouchId,
				request.params.blobId,
			);
			if (ciphertextHash) reply.header('ETag', `"${ciphertextHash}"`);
			reply.header('Cache-Control', 'private, max-age=31536000, immutable');
			return reply.type('application/octet-stream').send(bytes);
		},
	);

	app.post(
		'/v1/pouches/:pouchId/blobs/batch',
		{
			config: { auth: 'any', rateLimit: 'blobs' },
			bodyLimit: Limits.blobBatchMaxBytes + 64 * 1024,
			schema: {
				tags: ['sync'],
				summary:
					'Upload many small blobs in one request (framed body: id ‖ hash ‖ u32 len ‖ bytes)',
				params: PouchParam,
				response: { 200: BlobBatchResponse },
			},
		},
		async (request) => {
			const principal = principalOf(request);
			const frames = parseUploadFrames(bodyBuffer(request.body));
			const stored: string[] = [];
			for (const frame of frames) {
				const id = toBase64Url(frame.id);
				await putBlob(
					deps,
					principal,
					request.params.pouchId,
					id,
					Buffer.from(frame.bytes),
					toBase64Url(frame.hash),
				);
				stored.push(id);
			}
			return { stored };
		},
	);

	app.post(
		'/v1/pouches/:pouchId/blobs/fetch',
		{
			config: { auth: 'any', rateLimit: 'blobs', raw: true },
			schema: {
				tags: ['sync'],
				summary: 'Download many blobs in one framed response (id ‖ u32 len ‖ bytes)',
				params: PouchParam,
				body: BlobFetchRequest,
				response: { 404: z.unknown() },
			},
		},
		async (request, reply) => {
			const principal = principalOf(request);
			const items: { id: Buffer; bytes: Buffer }[] = [];
			const missing: string[] = [];
			for (const id of new Set(request.body.ids)) {
				try {
					const { bytes } = await getBlob(deps, principal, request.params.pouchId, id);
					items.push({ id: Buffer.from(id, 'base64url'), bytes });
				} catch (error) {
					if (error instanceof AppError && error.code === 'not_found') missing.push(id);
					else throw error;
				}
			}
			if (missing.length > 0) throw new AppError('not_found', { missing });
			return reply.type('application/octet-stream').send(encodeDownloadFrames(items));
		},
	);
}
