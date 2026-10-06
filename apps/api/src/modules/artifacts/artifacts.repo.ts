// SPDX-License-Identifier: AGPL-3.0-only
/** Reads of artifacts and revisions — opaque IDs + encrypted envelopes (03 §5.7–5.8). */
import { toBase64Url } from '@skillpouch/contracts';
import { revisionBlobs, revisions } from '@skillpouch/db';
import { inArray } from 'drizzle-orm';
import type { TenantTx } from '../../security/tenant-tx';

type RevisionRow = typeof revisions.$inferSelect;

/** Loads revisions with their blob ids, batched (no N+1). */
export async function loadRevisionViews(tx: TenantTx, ids: string[]) {
	if (ids.length === 0) return new Map<string, ReturnType<typeof revisionView>>();
	const rows = await tx.select().from(revisions).where(inArray(revisions.id, ids));
	const blobRows = await tx
		.select({ revisionId: revisionBlobs.revisionId, blobId: revisionBlobs.blobId })
		.from(revisionBlobs)
		.where(inArray(revisionBlobs.revisionId, ids));
	const blobsByRevision = new Map<string, string[]>();
	for (const row of blobRows) {
		const list = blobsByRevision.get(row.revisionId) ?? [];
		list.push(toBase64Url(row.blobId));
		blobsByRevision.set(row.revisionId, list);
	}
	return new Map(
		rows.map((row) => [row.id, revisionView(row, blobsByRevision.get(row.id) ?? [])]),
	);
}

export function revisionView(row: RevisionRow, blobIds: string[]) {
	return {
		id: row.id,
		artifact_id: row.artifactId,
		parent_id: row.parentId,
		merge_parent_id: row.mergeParentId,
		envelope: toBase64Url(row.envelope),
		envelope_hash: toBase64Url(row.envelopeHash),
		signature: toBase64Url(row.signature),
		signer_member_id: row.signerMemberId,
		key_gen: row.keyGen,
		stored_size: row.storedSize,
		origin: row.origin,
		author_device_id: row.authorDeviceId,
		blob_ids: blobIds.sort(),
		created_at: row.createdAt.toISOString(),
	};
}
