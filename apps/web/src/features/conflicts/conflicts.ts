// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Conflicts: an item changed in two places at once. The server keeps both
 * versions (the pouch's and the one that arrived on top of an older one)
 * until someone picks one here. Picking commits a signed `resolve` on top
 * of the item's current version, with the other one as its second parent.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api/client';
import { queryKeys } from '@/lib/api/query-keys';
import type { PouchRecord, RevisionRecord } from '@/lib/api/types';
import {
	fetchIngredientFiles,
	openHead,
	type ConflictRecord,
	type Ingredient,
} from '../ingredients/ingredients';
import { currentKeyring, useUnlocked } from '../session/session-store';
import { commitIngredient } from '../ingredients/write';

/** One side of a conflict, decrypted. */
export interface ConflictVersion {
	revision: Ingredient;
	files: { path: string; bytes: Uint8Array }[];
}

export interface ConflictVersions {
	/** The item as the pouch has it now. */
	head: Ingredient;
	/** What the pouch had when the conflict opened. */
	pouch: ConflictVersion | null;
	/** What arrived on top of an older version. */
	incoming: ConflictVersion | null;
}

export type Keep = 'pouch' | 'incoming';

async function fetchRevisions(pouchId: string, ids: string[]): Promise<RevisionRecord[]> {
	if (ids.length === 0) return [];
	const { revisions } = await api.get<{ revisions: RevisionRecord[] }>(
		`/v1/pouches/${pouchId}/revisions`,
		{ query: { ids: ids.join(',') } },
	);
	return revisions;
}

export async function loadConflictVersions(
	pouchId: string,
	conflict: ConflictRecord,
): Promise<ConflictVersions> {
	const keyring = currentKeyring();
	const ids = [
		conflict.head_revision_id,
		conflict.server_revision_id,
		conflict.incoming_revision_id,
	].filter((id): id is string => id !== null);
	const records = new Map(
		(await fetchRevisions(pouchId, [...new Set(ids)])).map((record) => [record.id, record]),
	);
	const open = async (id: string | null): Promise<Ingredient | null> => {
		const record = id ? records.get(id) : undefined;
		return record ? openHead(keyring, pouchId, record, record.created_at, false) : null;
	};
	const withFiles = async (id: string | null): Promise<ConflictVersion | null> => {
		const revision = await open(id);
		if (!revision) return null;
		const files = revision.deleted
			? new Map<string, Uint8Array>()
			: await fetchIngredientFiles(keyring, pouchId, revision);
		return {
			revision,
			files: [...files].map(([path, bytes]) => ({ path, bytes })),
		};
	};
	const [head, pouch, incoming] = await Promise.all([
		open(conflict.head_revision_id),
		withFiles(conflict.server_revision_id ?? conflict.head_revision_id),
		withFiles(conflict.incoming_revision_id),
	]);
	if (!head) throw new Error('The item is gone from the pouch.');
	return { head, pouch, incoming };
}

export function useConflictVersions(pouchId: string, conflict: ConflictRecord) {
	return useQuery({
		queryKey: [...queryKeys.conflicts(pouchId), conflict.id, conflict.head_revision_id],
		queryFn: () => loadConflictVersions(pouchId, conflict),
		staleTime: Number.POSITIVE_INFINITY,
	});
}

/** The version to keep, or null when it can't be kept (it never existed). */
export function chosen(versions: ConflictVersions, keep: Keep): ConflictVersion | null {
	return keep === 'pouch' ? versions.pouch : versions.incoming;
}

export function useResolveConflict(pouch: Pick<PouchRecord, 'id' | 'epoch'>) {
	const client = useQueryClient();
	const { keyring } = useUnlocked();
	return useMutation({
		mutationFn: async (input: {
			conflict: ConflictRecord;
			versions: ConflictVersions;
			keep: Keep;
		}) => {
			const { conflict, versions, keep } = input;
			const version = chosen(versions, keep);
			if (!version || !conflict.artifact_id) throw new Error('That version is gone.');
			const other =
				keep === 'pouch' ? conflict.incoming_revision_id : conflict.server_revision_id;
			const kept = version.revision;
			const { revisionId } = await commitIngredient({
				keyring,
				pouch,
				type: 'resolve',
				artifactId: conflict.artifact_id,
				base: versions.head,
				kind: kept.kind,
				scope: kept.scope,
				name: kept.name,
				previousEntries: kept.files,
				mergeParentId: other ?? null,
				conflictId: conflict.id,
			});
			// Keeping a deletion: the resolution names the item, so delete it after.
			if (kept.deleted) {
				await commitIngredient({
					keyring,
					pouch,
					type: 'delete',
					artifactId: conflict.artifact_id,
					base: { revisionId },
					kind: kept.kind,
					scope: kept.scope,
					name: kept.name,
					previousEntries: kept.files,
				});
			}
		},
		onSettled: () =>
			Promise.all([
				client.invalidateQueries({ queryKey: queryKeys.conflicts(pouch.id) }),
				client.invalidateQueries({ queryKey: queryKeys.contents(pouch.id) }),
			]),
	});
}
