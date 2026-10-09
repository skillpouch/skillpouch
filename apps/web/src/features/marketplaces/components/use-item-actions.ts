// SPDX-License-Identifier: AGPL-3.0-only
import { useState } from 'react';
import { toast } from 'sonner';
import type { Ingredient } from '@/features/ingredients/ingredients';
import { kindDefinition, type KindDefinition } from '@/features/ingredients/kinds';
import { useDeleteIngredient, useInvalidateContents } from '@/features/ingredients/mutations';
import type { PouchView } from '@/features/pouches/pouches';
import { describeError } from '@/lib/api/errors';
import { addItemToPouch, type MarketplaceItemContent } from '../marketplaces';

export type ItemAdded = (result: { name: string; kind: KindDefinition }) => void;

/** Adds or removes one item at a time; remembers which one is in flight. */
export function useItemActions(pouch: PouchView, onAdded: ItemAdded | undefined) {
	const invalidate = useInvalidateContents(pouch.id);
	const deletion = useDeleteIngredient(pouch);
	const [busyKey, setBusyKey] = useState<string | null>(null);
	const add = async (key: string, load: () => Promise<MarketplaceItemContent>) => {
		setBusyKey(key);
		try {
			const item = await load();
			const definition = kindDefinition(item.kind);
			if (!definition) throw new Error('This item type can’t be added to a pouch.');
			const { name } = await addItemToPouch({
				pouch,
				item,
				duplicate: definition.single ? 'append' : 'keep_both',
			});
			await invalidate();
			toast.success(
				definition.single
					? `Added to ${definition.label}`
					: `Added ${name} to ${definition.label}`,
			);
			onAdded?.({ name, kind: definition });
		} catch (error) {
			toast.error(describeError(error));
		} finally {
			setBusyKey(null);
		}
	};
	const remove = async (key: string, ingredient: Ingredient) => {
		setBusyKey(key);
		try {
			await deletion.mutateAsync(ingredient);
			toast.success(`Removed ${ingredient.name}`);
		} catch (error) {
			toast.error(describeError(error));
		} finally {
			setBusyKey(null);
		}
	};
	return { busyKey, add, remove };
}
