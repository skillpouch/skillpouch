// SPDX-License-Identifier: AGPL-3.0-only
/** React Query mutations for adding, editing, deleting and restoring ingredients. */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '@/lib/api/query-keys';
import type { PouchRecord } from '@/lib/api/types';
import { currentKeyring } from '../session/session-store';
import type { Ingredient } from './ingredients';
import type { IngredientKind } from './kinds';
import { commitIngredient, type DraftFile } from './write';

export function useInvalidateContents(pouchId: string) {
	const client = useQueryClient();
	return () =>
		Promise.all([
			client.invalidateQueries({ queryKey: queryKeys.contents(pouchId) }),
			client.invalidateQueries({ queryKey: queryKeys.conflicts(pouchId) }),
			client.invalidateQueries({ queryKey: queryKeys.me }),
			client.invalidateQueries({ queryKey: queryKeys.storage }),
		]);
}

type PouchRef = Pick<PouchRecord, 'id' | 'epoch'>;

export function useCreateIngredient(pouch: PouchRef) {
	const invalidate = useInvalidateContents(pouch.id);
	return useMutation({
		mutationFn: (input: { kind: IngredientKind; name: string; files: DraftFile[] }) =>
			commitIngredient({
				keyring: currentKeyring(),
				pouch,
				type: 'create',
				artifactId: crypto.randomUUID(),
				base: null,
				kind: input.kind,
				name: input.name,
				files: input.files,
			}),
		onSettled: invalidate,
	});
}

export function useUpdateIngredient(pouch: PouchRef) {
	const invalidate = useInvalidateContents(pouch.id);
	return useMutation({
		mutationFn: (input: { ingredient: Ingredient; name: string; files: DraftFile[] }) =>
			commitIngredient({
				keyring: currentKeyring(),
				pouch,
				type: input.name === input.ingredient.name ? 'update' : 'rename',
				artifactId: input.ingredient.id,
				base: input.ingredient,
				kind: input.ingredient.kind,
				scope: input.ingredient.scope,
				name: input.name,
				files: input.files,
			}),
		onSettled: invalidate,
	});
}

export function useDeleteIngredient(pouch: PouchRef) {
	const invalidate = useInvalidateContents(pouch.id);
	return useMutation({
		mutationFn: (ingredient: Ingredient) =>
			commitIngredient({
				keyring: currentKeyring(),
				pouch,
				type: 'delete',
				artifactId: ingredient.id,
				base: ingredient,
				kind: ingredient.kind,
				scope: ingredient.scope,
				name: ingredient.name,
				previousEntries: ingredient.files,
			}),
		onSettled: invalidate,
	});
}
