// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Storage usage and "Free up space". The server reports sizes per pouch and
 * per artifact only — it can't see names — so the browser joins them with
 * the decrypted contents.
 *
 * Freeing space never lets the server decide what to delete: live items are
 * removed with signed `delete` operations first, then their history is purged.
 */
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api/client';
import { queryKeys } from '@/lib/api/query-keys';
import type { FreeSpaceResult, PouchRecord, StorageUsageRecord } from '@/lib/api/types';
import { currentKeyring } from '../session/session-store';
import type { Ingredient } from '../ingredients/ingredients';
import { commitIngredient } from '../ingredients/write';

export function useStorage(enabled = true) {
	return useQuery({
		queryKey: queryKeys.storage,
		queryFn: () => api.get<StorageUsageRecord>('/v1/account/storage'),
		enabled,
	});
}

export interface FreeSpacePlan {
	/** Pouches whose history and trash are purged. */
	historyOf: string[];
	/** Live items to delete (signed) and purge, per pouch. */
	items: { pouch: Pick<PouchRecord, 'id' | 'epoch'>; ingredients: Ingredient[] }[];
	/** Whole pouches deleted immediately (no undo window). */
	pouches: string[];
}

export interface FreeSpaceProgress {
	done: number;
	total: number;
}

/** Runs a plan step by step; resolves with the final usage. */
export async function freeSpace(
	plan: FreeSpacePlan,
	onProgress: (progress: FreeSpaceProgress) => void = () => undefined,
): Promise<FreeSpaceResult | null> {
	const total =
		plan.historyOf.length +
		plan.pouches.length +
		plan.items.reduce((sum, group) => sum + group.ingredients.length + 1, 0);
	let done = 0;
	const step = () => onProgress({ done: ++done, total });
	let last: FreeSpaceResult | null = null;

	for (const pouchId of plan.pouches) {
		await api.delete(`/v1/pouches/${pouchId}`, { query: { skip_undo: 'true' } });
		step();
	}
	const deletedPouches = new Set(plan.pouches);
	for (const group of plan.items) {
		if (deletedPouches.has(group.pouch.id)) continue;
		for (const ingredient of group.ingredients) {
			await commitIngredient({
				keyring: currentKeyring(),
				pouch: group.pouch,
				type: 'delete',
				artifactId: ingredient.id,
				base: ingredient,
				kind: ingredient.kind,
				scope: ingredient.scope,
				name: ingredient.name,
				previousEntries: ingredient.files,
			});
			step();
		}
		if (group.ingredients.length > 0) {
			last = await api.post<FreeSpaceResult>(`/v1/pouches/${group.pouch.id}/free-space`, {
				artifact_ids: group.ingredients.map((ingredient) => ingredient.id),
			});
		}
		step();
	}
	for (const pouchId of plan.historyOf) {
		if (!deletedPouches.has(pouchId)) {
			last = await api.post<FreeSpaceResult>(`/v1/pouches/${pouchId}/free-space`, {});
		}
		step();
	}
	return last;
}
