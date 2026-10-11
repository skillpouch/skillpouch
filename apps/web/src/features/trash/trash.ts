// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The trash: deleted items keep their files for 7 days, so they can be
 * restored. "Delete permanently" removes the files right away; after 7 days
 * the server does it (`trash.empty`). The signed delete always stays, so
 * every computer removes its copy.
 */
import { Limits } from '@skillpouch/contracts';
import { useMutation } from '@tanstack/react-query';
import { api } from '@/lib/api/client';
import type { FreeSpaceResult, PouchRecord } from '@/lib/api/types';
import { currentKeyring } from '../session/session-store';
import { nameTaken, type Ingredient } from '../ingredients/ingredients';
import { NAME_MAX, kindDefinition, validateName } from '../ingredients/kinds';
import { useInvalidateContents } from '../ingredients/mutations';
import { commitIngredient } from '../ingredients/write';

type PouchRef = Pick<PouchRecord, 'id' | 'epoch'>;

/** When the server removes a trashed item's files. */
export function removalDate(item: Pick<Ingredient, 'deletedAt'>): Date {
	return new Date(
		new Date(item.deletedAt ?? Date.now()).getTime() + Limits.trashRetentionDays * 86_400_000,
	);
}

/** Why `name` can't be used to restore `item` among the live `ingredients`, or null. */
export function restoreNameProblem(
	ingredients: Ingredient[],
	item: Pick<Ingredient, 'id' | 'kind'>,
	name: string,
): string | null {
	const invalid = validateName(name);
	if (invalid) return invalid;
	const taken = nameTaken(ingredients, item.kind, name, item.id);
	if (!taken) return null;
	const singular = kindDefinition(item.kind)?.singular.toLowerCase() ?? 'item';
	return `There is already a ${singular} called “${taken.name}”. Pick another name.`;
}

/** `name-2`, `name-3`, … : the first free name to offer when restoring over a taken one. */
export function suggestRestoreName(
	ingredients: Ingredient[],
	item: Pick<Ingredient, 'id' | 'kind' | 'name'>,
): string {
	for (let n = 2; ; n++) {
		const suffix = `-${n}`;
		const name = item.name.slice(0, NAME_MAX - suffix.length) + suffix;
		if (!nameTaken(ingredients, item.kind, name, item.id)) return name;
	}
}

/** Brings a trashed item back, under `name` (its own, or a new one if that's taken). */
export function useRestoreIngredient(pouch: PouchRef) {
	const invalidate = useInvalidateContents(pouch.id);
	return useMutation({
		mutationFn: ({ item, name }: { item: Ingredient; name: string }) =>
			commitIngredient({
				keyring: currentKeyring(),
				pouch,
				type: 'restore',
				artifactId: item.id,
				base: item,
				kind: item.kind,
				scope: item.scope,
				name,
				previousEntries: item.files,
			}),
		onSettled: invalidate,
	});
}

/** Removes the files of trashed items now; they can't be restored afterwards. */
export function useDeletePermanently(pouch: PouchRef) {
	const invalidate = useInvalidateContents(pouch.id);
	return useMutation({
		mutationFn: (items: Ingredient[]) =>
			api.post<FreeSpaceResult>(`/v1/pouches/${pouch.id}/free-space`, {
				artifact_ids: items.map((item) => item.id),
			}),
		onSettled: invalidate,
	});
}
