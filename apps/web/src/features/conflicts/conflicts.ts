// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Conflicts: an item changed in two places at once, or two items made with
 * the same name. The server keeps both versions until someone picks one.
 *
 *  - Changed in two places: picking commits a signed `resolve` on top of the
 *    item's current version, with the other one as its second parent.
 *  - Same name (`name_collision`): the new item waits, hidden, next to the
 *    one that has the name. Keeping the existing one drops the new item;
 *    keeping the new one writes its files into the existing item, then
 *    drops the new one. Either way one item keeps the name.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api/client';
import { queryKeys } from '@/lib/api/query-keys';
import type { PouchRecord, RevisionRecord } from '@/lib/api/types';
import {
	fetchIngredientFiles,
	loadPouchContents,
	nameTaken,
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
	/** The conflicted item as the server has it now. */
	head: Ingredient;
	/** What the pouch has: its version of the item, or the item holding the name. */
	pouch: ConflictVersion | null;
	/** What arrived at the same time. */
	incoming: ConflictVersion | null;
	/** For a name collision: the live item that holds the name. */
	holder: Ingredient | null;
}

export type Keep = 'pouch' | 'incoming';

/** One card per item: the newest open conflict of each. */
export function latestPerItem(conflicts: ConflictRecord[]): ConflictRecord[] {
	const latest = new Map<string, ConflictRecord>();
	for (const conflict of conflicts) {
		if (!conflict.artifact_id) continue;
		const seen = latest.get(conflict.artifact_id);
		if (!seen || seen.created_at < conflict.created_at) {
			latest.set(conflict.artifact_id, conflict);
		}
	}
	return [...latest.values()].sort((a, b) => b.created_at.localeCompare(a.created_at));
}

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
	// Historical sides are for display; only the verified listing can authorize
	// a mutation base. Never promote a conflict record's claimed head directly.
	const contents = await loadPouchContents(keyring, pouchId, true);
	const current = contents.ingredients.find((item) => item.id === conflict.artifact_id);
	if (!current || current.revisionId !== conflict.head_revision_id) {
		throw new Error('Cannot verify the current version of this conflicted item.');
	}
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
		return record
			? openHead(
					keyring,
					pouchId,
					record,
					record.created_at,
					conflict.artifact_id ?? undefined,
				)
			: null;
	};
	const ancestorOf = async (descendant: Ingredient, target: string): Promise<boolean> => {
		const visited = new Set<string>();
		let parent = descendant.body.parent_id;
		for (let depth = 0; parent && depth < 64 && !visited.has(parent); depth++) {
			if (parent === target) return true;
			visited.add(parent);
			const [record] = await fetchRevisions(pouchId, [parent]);
			if (!record || record.id !== parent) return false;
			const opened = await openHead(
				keyring,
				pouchId,
				record,
				record.created_at,
				conflict.artifact_id ?? undefined,
			);
			if (!opened) return false;
			parent = opened.body.parent_id;
		}
		return false;
	};
	const withFiles = async (revision: Ingredient | null): Promise<ConflictVersion | null> => {
		if (!revision) return null;
		const files = revision.deleted
			? new Map<string, Uint8Array>()
			: await fetchIngredientFiles(keyring, pouchId, revision);
		return {
			revision,
			files: [...files].map(([path, bytes]) => ({ path, bytes })),
		};
	};
	const [head, server, incoming] = await Promise.all([
		open(conflict.head_revision_id),
		open(
			conflict.type === 'name_collision'
				? null
				: (conflict.server_revision_id ?? conflict.head_revision_id),
		),
		open(conflict.incoming_revision_id),
	]);
	if (!head || head.id !== conflict.artifact_id)
		throw new Error('The item is gone from the pouch.');
	if (
		(conflict.type !== 'name_collision' && conflict.server_revision_id && !server) ||
		(conflict.incoming_revision_id && !incoming)
	)
		throw new Error('A signed conflict side is unavailable; cannot resolve it.');
	if (head.revisionId !== current.revisionId)
		throw new Error('Conflict head does not match the verified item.');
	if (conflict.type !== 'name_collision') {
		if (
			server &&
			server.revisionId !== head.revisionId &&
			!(await ancestorOf(head, server.revisionId))
		)
			throw new Error('Conflict pouch side is not in the verified item history.');
		if (
			incoming &&
			incoming.revisionId !== head.revisionId &&
			(!incoming.body.parent_id ||
				(incoming.body.parent_id !== head.revisionId &&
					incoming.body.parent_id !== server?.revisionId &&
					!(await ancestorOf(head, incoming.body.parent_id))))
		)
			throw new Error('Conflict incoming side has no shared signed history.');
	}

	let holder: Ingredient | null = null;
	let pouch = server;
	if (conflict.type === 'name_collision') {
		// The item that holds the name now, found by name: the server's
		// record may point at an older version of it.
		const visible = await loadPouchContents(keyring, pouchId, false);
		holder = nameTaken(visible.ingredients, head.kind, head.name, head.id) ?? null;
		pouch = holder;
	}
	const [pouchSide, incomingSide] = await Promise.all([withFiles(pouch), withFiles(incoming)]);
	return { head, pouch: pouchSide, incoming: incomingSide, holder };
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
			const kept = version.revision;
			const { head } = versions;

			// Nothing holds the name any more: keeping the new item just names it.
			if (conflict.type === 'name_collision' && !(keep === 'incoming' && !versions.holder)) {
				const holder = versions.holder;
				if (keep === 'incoming' && holder) {
					// The item with the name gets the new files.
					await commitIngredient({
						keyring,
						pouch,
						type: 'update',
						artifactId: holder.id,
						base: holder,
						kind: holder.kind,
						scope: holder.scope,
						name: holder.name,
						previousEntries: kept.files,
					});
				}
				// The waiting item goes; nothing claims the name twice.
				await commitIngredient({
					keyring,
					pouch,
					type: 'resolve',
					artifactId: conflict.artifact_id,
					base: head,
					kind: head.kind,
					scope: head.scope,
					name: head.name,
					previousEntries: head.files,
					conflictId: conflict.id,
					discard: true,
				});
				return;
			}

			const other =
				conflict.type === 'name_collision'
					? null
					: keep === 'pouch'
						? versions.incoming?.revision.revisionId
						: versions.pouch?.revision.revisionId;
			const { revisionId } = await commitIngredient({
				keyring,
				pouch,
				type: 'resolve',
				artifactId: conflict.artifact_id,
				base: head,
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
