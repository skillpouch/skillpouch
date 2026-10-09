// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `/app/p/:pouchId/:kind` — the global items of one ingredient type. The open
 * panel lives in the URL, so it survives reloads and search results can link
 * straight to an item.
 */
import { PageSkeleton } from '@/components/ui/page-skeleton';
import { useNavigate, useParams, useSearch } from '@tanstack/react-router';
import { Plus } from 'lucide-react';
import { useState } from 'react';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import {
	IngredientList,
	useKindIngredients,
	type PanelSearch,
} from '@/features/ingredients/components/ingredient-list';
import { kindBySlug } from '@/features/ingredients/kinds';
import { AddIngredientDialog } from '@/features/marketplaces/components/add-ingredient-dialog';
import { usePouch } from '@/features/pouches/pouches';
import { plural } from '@/lib/format';
import { NotFoundPage } from '../not-found-page';

export type IngredientsSearch = PanelSearch;

export function IngredientsPage() {
	const { pouchId, kind: slug } = useParams({ strict: false }) as {
		pouchId: string;
		kind: string;
	};
	const search = useSearch({ strict: false }) as IngredientsSearch;
	const navigate = useNavigate();
	const kind = kindBySlug(slug);
	const pouch = usePouch(pouchId).data;
	const { items } = useKindIngredients(pouchId, kind);
	const [choosing, setChoosing] = useState(false);

	if (!kind) return <NotFoundPage />;
	if (!pouch) return <PageSkeleton variant="list" />;
	const readOnly = pouch.state !== 'active';
	const setPanel = (next: IngredientsSearch) =>
		void navigate({
			to: '/app/p/$pouchId/$kind',
			params: { pouchId, kind: kind.slug },
			search: next,
			replace: true,
		});

	return (
		<>
			<PageHeader
				title={kind.label}
				description={
					kind.single
						? `Used by every assistant on your computers, in ${pouch.name}`
						: `${plural(items.length, kind.singular.toLowerCase())} in ${pouch.name}`
				}
				actions={
					readOnly || kind.single ? null : (
						<Button variant="primary" onClick={() => setChoosing(true)}>
							<Plus /> Add {kind.singular.toLowerCase()}
						</Button>
					)
				}
			/>
			<IngredientList pouch={pouch} kind={kind} search={search} onPanel={setPanel} />
			<AddIngredientDialog
				open={choosing}
				onOpenChange={setChoosing}
				pouch={pouch}
				kind={kind}
				onWrite={() => setPanel({ new: true })}
			/>
		</>
	);
}
