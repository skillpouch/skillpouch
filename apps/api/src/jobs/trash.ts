// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Emptying the trash. A deleted item keeps its files for 7 days, so it can
 * be restored; then its files and older versions are removed, the same way
 * "Delete permanently" does it. Its signed delete always stays (see
 * `releaseFiles`). Items whose versions an open conflict pins wait for it.
 */
import { Limits } from '@skillpouch/contracts';
import { sql } from 'drizzle-orm';
import type { Deps } from '../deps';
import { releaseFiles } from '../modules/storage/storage.service';
import { rows } from './sql';

const BATCH = 200;

export async function emptyTrash(deps: Deps): Promise<number> {
	let total = 0;
	for (;;) {
		const due = rows<{ storage_account_id: string; pouch_id: string; id: string }>(
			await deps.db.maintenance.execute(sql`
				WITH pinned AS (
					SELECT unnest(ARRAY[base_revision_id, server_revision_id, incoming_revision_id]) AS id
					FROM conflicts WHERE state = 'open'
				)
				SELECT a.storage_account_id, a.pouch_id, a.id FROM artifacts a
				WHERE a.deleted_at < now() - make_interval(days => ${Limits.trashRetentionDays})
					AND a.head_revision_id IS NOT NULL
					AND NOT EXISTS (SELECT 1 FROM pinned p WHERE p.id = a.head_revision_id)
					AND (
						EXISTS (SELECT 1 FROM revision_blobs rb WHERE rb.revision_id = a.head_revision_id)
						OR EXISTS (
							SELECT 1 FROM revisions r
							WHERE r.artifact_id = a.id AND r.id <> a.head_revision_id
								AND NOT EXISTS (SELECT 1 FROM pinned p WHERE p.id = r.id)
						)
					)
				ORDER BY a.deleted_at
				LIMIT ${BATCH}`),
		);
		const perPouch = new Map<string, { storageAccountId: string; artifactIds: string[] }>();
		for (const row of due) {
			const group = perPouch.get(row.pouch_id) ?? {
				storageAccountId: row.storage_account_id,
				artifactIds: [],
			};
			group.artifactIds.push(row.id);
			perPouch.set(row.pouch_id, group);
		}
		for (const [pouchId, group] of perPouch) {
			await releaseFiles(deps, {
				storageAccountId: group.storageAccountId,
				pouchId,
				artifactIds: group.artifactIds,
				actor: 'system',
				action: 'trash.emptied',
			});
		}
		total += due.length;
		if (due.length < BATCH) return total;
	}
}
