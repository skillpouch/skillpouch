// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `/app/p/:pouchId/:kind` — the list of one ingredient type. The open panel
 * lives in the URL (`?item=<id>&mode=edit`, `?new=1`), so it survives reloads
 * and search results can link straight to an item.
 */
import { PageSkeleton } from '@/components/ui/page-skeleton';
import { useNavigate, useParams, useSearch } from '@tanstack/react-router';
import { Plus } from 'lucide-react';
import { useMemo, useState } from 'react';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { ErrorMessage } from '@/components/ui/error-message';
import { Input } from '@/components/ui/input';
import { toast } from '@/components/ui/toast';
import {
	IngredientSheet,
	type SheetMode,
} from '@/features/ingredients/components/ingredient-sheet';
import { IngredientTable } from '@/features/ingredients/components/ingredient-table';
import {
	useDescriptions,
	useOpenConflicts,
	usePouchContents,
	type Ingredient,
} from '@/features/ingredients/ingredients';
import { kindBySlug } from '@/features/ingredients/kinds';
import { useDeleteIngredient } from '@/features/ingredients/mutations';
import { usePouch } from '@/features/pouches/pouches';
import { ShareDialog } from '@/features/shares/components/share-dialog';
import { plural } from '@/lib/format';
import { NotFoundPage } from '../not-found-page';

export interface IngredientsSearch {
	item?: string;
	mode?: 'show' | 'edit';
	new?: boolean;
}

export function IngredientsPage() {
	const { pouchId, kind: slug } = useParams({ strict: false }) as {
		pouchId: string;
		kind: string;
	};
	const search = useSearch({ strict: false }) as IngredientsSearch;
	const navigate = useNavigate();
	const kind = kindBySlug(slug);
	const pouch = usePouch(pouchId).data;
	const contents = usePouchContents(pouchId);
	const conflicts = useOpenConflicts(pouchId);
	const [filter, setFilter] = useState('');
	const [sharing, setSharing] = useState<Ingredient | null>(null);
	const [deleting, setDeleting] = useState<Ingredient | null>(null);
	const remove = useDeleteIngredient(pouch ?? { id: pouchId, epoch: '' });

	const all = useMemo(
		() =>
			(contents.data?.ingredients ?? []).filter(
				(ingredient) => ingredient.kind === kind?.kind && !ingredient.deleted,
			),
		[contents.data, kind?.kind],
	);
	const descriptions = useDescriptions(pouchId, all);
	const needle = filter.trim().toLowerCase();
	const items = needle
		? all.filter(
				(item) =>
					item.name.toLowerCase().includes(needle) ||
					descriptions.data?.get(item.id)?.toLowerCase().includes(needle),
			)
		: all;
	const conflicted = new Set(
		(conflicts.data ?? []).map((conflict) => conflict.artifact_id).filter(Boolean) as string[],
	);

	if (!kind) return <NotFoundPage />;
	if (!pouch) return <PageSkeleton variant="list" />;
	const readOnly = pouch.state !== 'active';
	const selected = search.item ? (all.find((item) => item.id === search.item) ?? null) : null;
	const mode: SheetMode | null = search.new
		? 'create'
		: selected
			? (search.mode ?? 'show')
			: null;

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
				description={`${plural(all.length, kind.singular.toLowerCase())} in ${pouch.name}`}
				actions={
					readOnly ? null : (
						<Button variant="primary" onClick={() => setPanel({ new: true })}>
							<Plus /> Add {kind.singular.toLowerCase()}
						</Button>
					)
				}
			/>
			{all.length > 0 ? (
				<div className="mb-4 max-w-xs">
					<Input
						value={filter}
						onChange={(event) => setFilter(event.target.value)}
						placeholder="Filter by name…"
						aria-label={`Filter ${kind.label.toLowerCase()}`}
					/>
				</div>
			) : null}
			<ErrorMessage error={contents.error} className="mb-4" />
			{!contents.isPending && all.length === 0 ? (
				<EmptyState
					icon={kind.icon}
					title={`No ${kind.label.toLowerCase()} yet`}
					description={kind.blurb}
					action={
						readOnly ? null : (
							<Button onClick={() => setPanel({ new: true })}>
								<Plus /> Add {kind.singular.toLowerCase()}
							</Button>
						)
					}
				/>
			) : (
				<IngredientTable
					items={items}
					descriptions={descriptions.data}
					conflicted={conflicted}
					readOnly={readOnly}
					loading={contents.isPending}
					onShow={(item) => setPanel({ item: item.id })}
					onEdit={(item) => setPanel({ item: item.id, mode: 'edit' })}
					onShare={setSharing}
					onDelete={setDeleting}
				/>
			)}
			{contents.data && contents.data.unreadable.length > 0 ? (
				<p className="mt-4 text-xs text-warn">
					{plural(contents.data.unreadable.length, 'item')} in this pouch couldn’t be
					verified and were not opened.
				</p>
			) : null}

			<IngredientSheet
				pouch={pouch}
				kind={kind}
				ingredient={selected}
				mode={mode}
				readOnly={readOnly}
				onModeChange={(next) =>
					selected &&
					setPanel({ item: selected.id, ...(next === 'edit' ? { mode: 'edit' } : {}) })
				}
				onClose={() => setPanel({})}
				onShare={setSharing}
				onDelete={setDeleting}
				onCreated={() => {
					toast.success(`${kind.singular} added`);
					setPanel({});
				}}
			/>
			<ShareDialog
				pouchId={pouchId}
				ingredient={sharing}
				description={sharing ? (descriptions.data?.get(sharing.id) ?? '') : ''}
				onClose={() => setSharing(null)}
			/>
			<ConfirmDialog
				open={deleting !== null}
				onOpenChange={(open) => !open && setDeleting(null)}
				title={`Delete ${deleting?.name ?? ''}?`}
				description="It will be removed from this pouch and from all connected computers on next sync. Older versions are kept for 30 days."
				confirmLabel="Delete"
				onConfirm={async () => {
					if (!deleting) return;
					await remove.mutateAsync(deleting);
					if (search.item === deleting.id) setPanel({});
					toast.success(`${deleting.name} deleted`);
				}}
			/>
		</>
	);
}
