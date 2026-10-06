// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Artifact browsing. Everything returned is opaque: names,
 * paths and content are inside the encrypted envelopes; filtering and search
 * happen client-side after decryption.
 */
import {
	Artifact,
	ArtifactListQuery,
	PageQuery,
	PouchParam,
	Revision,
	RevisionsQuery,
	Uuid,
} from '@skillpouch/contracts';
import { artifacts, revisions } from '@skillpouch/db';
import { and, asc, desc, eq, gt, isNull, lt } from 'drizzle-orm';
import { z } from 'zod';
import type { Deps } from '../../deps';
import { AppError } from '../../http/app-error';
import { decodeCursor, encodeCursor } from '../../http/cursor';
import { principalOf } from '../../http/principal';
import { paginated } from '../../http/serialization';
import type { ZodApp } from '../../http/zod-app';
import { withTenantTx } from '../../security/tenant-tx';
import { findPouch } from '../pouches/pouches.service';
import { loadRevisionViews } from './artifacts.repo';

export async function artifactsRoutes(app: ZodApp, deps: Deps) {
	app.get(
		'/v1/pouches/:pouchId/artifacts',
		{
			config: { auth: 'any' },
			schema: {
				tags: ['artifacts'],
				summary: 'Live artifacts with their head revision (cursor pagination)',
				params: PouchParam,
				querystring: ArtifactListQuery,
				response: { 200: z.object({ items: z.array(Artifact) }) },
			},
		},
		async (request) => {
			const principal = principalOf(request);
			const after = decodeCursor(request.query.cursor);
			return withTenantTx(deps.db.app, principal.storageAccountId, async (tx) => {
				await findPouch(tx, request.params.pouchId, { includeDeleted: true });
				const conditions = [eq(artifacts.pouchId, request.params.pouchId)];
				if (!request.query.include_deleted) conditions.push(isNull(artifacts.deletedAt));
				if (after) conditions.push(gt(artifacts.id, after));
				const rows = await tx
					.select()
					.from(artifacts)
					.where(and(...conditions))
					.orderBy(asc(artifacts.id))
					.limit(request.query.limit + 1);
				const page = rows.slice(0, request.query.limit);
				const heads = await loadRevisionViews(
					tx,
					page.map((row) => row.headRevisionId).filter((id): id is string => id !== null),
				);
				return paginated(
					page.map((row) => ({
						id: row.id,
						name_index: row.nameIndex.toString('base64url'),
						deleted_at: row.deletedAt?.toISOString() ?? null,
						updated_at: row.updatedAt.toISOString(),
						head: row.headRevisionId ? (heads.get(row.headRevisionId) ?? null) : null,
					})),
					rows.length > request.query.limit ? encodeCursor(page.at(-1)!.id) : null,
				);
			});
		},
	);

	app.get(
		'/v1/pouches/:pouchId/artifacts/:artifactId/revisions',
		{
			config: { auth: 'any' },
			schema: {
				tags: ['artifacts'],
				summary: 'Revision history of one artifact, newest first',
				params: PouchParam.extend({ artifactId: Uuid }),
				querystring: PageQuery,
				response: { 200: z.object({ items: z.array(Revision) }) },
			},
		},
		async (request) => {
			const principal = principalOf(request);
			const before = decodeCursor(request.query.cursor);
			return withTenantTx(deps.db.app, principal.storageAccountId, async (tx) => {
				const [artifact] = await tx
					.select({ id: artifacts.id })
					.from(artifacts)
					.where(
						and(
							eq(artifacts.id, request.params.artifactId),
							eq(artifacts.pouchId, request.params.pouchId),
						),
					);
				if (!artifact) throw new AppError('not_found');
				const conditions = [eq(revisions.artifactId, artifact.id)];
				if (before) conditions.push(lt(revisions.id, before));
				const rows = await tx
					.select({ id: revisions.id })
					.from(revisions)
					.where(and(...conditions))
					.orderBy(desc(revisions.id))
					.limit(request.query.limit + 1);
				const page = rows.slice(0, request.query.limit);
				const views = await loadRevisionViews(
					tx,
					page.map((row) => row.id),
				);
				return paginated(
					page.map((row) => views.get(row.id)!),
					rows.length > request.query.limit ? encodeCursor(page.at(-1)!.id) : null,
				);
			});
		},
	);

	app.get(
		'/v1/pouches/:pouchId/revisions',
		{
			config: { auth: 'any' },
			schema: {
				tags: ['artifacts'],
				summary: 'Batch-fetch revisions (envelopes + signatures) by id',
				params: PouchParam,
				querystring: RevisionsQuery,
				response: { 200: z.object({ revisions: z.array(Revision) }) },
			},
		},
		async (request) => {
			const principal = principalOf(request);
			return withTenantTx(deps.db.app, principal.storageAccountId, async (tx) => {
				await findPouch(tx, request.params.pouchId, { includeDeleted: true });
				const views = await loadRevisionViews(tx, request.query.ids);
				const inPouch = await tx
					.select({ id: revisions.id })
					.from(revisions)
					.where(eq(revisions.pouchId, request.params.pouchId));
				const allowed = new Set(inPouch.map((row) => row.id));
				return {
					revisions: request.query.ids
						.filter((id) => allowed.has(id) && views.has(id))
						.map((id) => views.get(id)!),
				};
			});
		},
	);
}
