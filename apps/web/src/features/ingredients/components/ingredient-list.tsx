// SPDX-License-Identifier: AGPL-3.0-only
/**
 * One ingredient type: filter, table, the item panel and the
 * share / delete dialogs. The open panel lives in the URL (`?item=<id>&mode=edit`,
 * `?new=1`), so the page passes the search and how to change it.
 */
import { Plus } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { ErrorMessage } from '@/components/ui/error-message';
import { Input } from '@/components/ui/input';
import { toast } from '@/components/ui/toast';
import type { PouchView } from '@/features/pouches/pouches';
import { ShareDialog } from '@/features/shares/components/share-dialog';
import { plural } from '@/lib/format';
import {
	inScope,
	newestFirst,
	useDescriptions,
	useOpenConflicts,
	usePouchContents,
	type Ingredient,
} from '../ingredients';
import type { KindDefinition } from '../kinds';
import { useDeleteIngredient } from '../mutations';
import { IngredientSheet, type SheetMode } from './ingredient-sheet';
import { IngredientTable } from './ingredient-table';
import { SingleIngredient } from './single-ingredient';

export interface PanelSearch {
	item?: string;
	mode?: 'show' | 'edit';
	new?: boolean;
}

/** Live items of one kind. */
export function useKindIngredients(pouchId: string, kind: KindDefinition | undefined) {
	const contents = usePouchContents(pouchId);
	const items = useMemo(
		() => inScope(contents.data?.ingredients ?? []).filter((item) => item.kind === kind?.kind),
		[contents.data, kind?.kind],
	);
	return { contents, items };
}

export function IngredientList({
	pouch,
	kind,
	search,
	onPanel,
}: {
	pouch: PouchView;
	kind: KindDefinition;
	search: PanelSearch;
	onPanel: (next: PanelSearch) => void;
}) {
	const { contents, items: all } = useKindIngredients(pouch.id, kind);
	const conflicts = useOpenConflicts(pouch.id);
	const descriptions = useDescriptions(pouch.id, all);
	const [filter, setFilter] = useState('');
	const [sharing, setSharing] = useState<Ingredient | null>(null);
	const [deleting, setDeleting] = useState<Ingredient | null>(null);
	const remove = useDeleteIngredient(pouch);

	const readOnly = pouch.state !== 'active';
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
	const selected = search.item ? (all.find((item) => item.id === search.item) ?? null) : null;
	const [single = null, ...extras] = kind.single ? newestFirst(all) : [];
	// A single-item kind that already has its item never creates a second one.
	const mode: SheetMode | null =
		search.new && !single ? 'create' : selected ? (search.mode ?? 'show') : null;

	const tableActions = {
		onShow: (item: Ingredient) => onPanel({ item: item.id }),
		onEdit: (item: Ingredient) => onPanel({ item: item.id, mode: 'edit' }),
		onShare: setSharing,
		onDelete: setDeleting,
	};

	return (
		<>
			<ErrorMessage error={contents.error} className="mb-4" />
			{kind.single ? (
				<>
					<SingleIngredient
						pouchId={pouch.id}
						kind={kind}
						item={single}
						loading={contents.isPending}
						readOnly={readOnly}
						onCreate={() => onPanel({ new: true })}
						onEdit={tableActions.onEdit}
						onShare={setSharing}
					/>
					{extras.length > 0 ? (
						<section className="mt-8" aria-label={`Older ${kind.label.toLowerCase()}`}>
							<h2 className="text-sm font-medium">
								Older {kind.label.toLowerCase()}
							</h2>
							<p className="mt-1 mb-3 text-[13px] text-muted">
								Only the one above is used. Copy what you still need into it, then
								delete these.
							</p>
							<IngredientTable
								items={extras}
								descriptions={descriptions.data}
								conflicted={conflicted}
								readOnly={readOnly}
								loading={false}
								{...tableActions}
							/>
						</section>
					) : null}
				</>
			) : !contents.isPending && all.length === 0 ? (
				<EmptyState
					icon={kind.icon}
					title={`No ${kind.label.toLowerCase()} yet`}
					description={kind.blurb}
					action={
						readOnly ? null : (
							<Button onClick={() => onPanel({ new: true })}>
								<Plus /> Add {kind.singular.toLowerCase()}
							</Button>
						)
					}
				/>
			) : (
				<>
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
					<IngredientTable
						items={items}
						descriptions={descriptions.data}
						conflicted={conflicted}
						readOnly={readOnly}
						loading={contents.isPending}
						{...tableActions}
					/>
				</>
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
					onPanel({ item: selected.id, ...(next === 'edit' ? { mode: 'edit' } : {}) })
				}
				onClose={() => onPanel({})}
				onShare={setSharing}
				onDelete={setDeleting}
				onCreated={() => {
					toast.success(kind.single ? `${kind.label} saved` : `${kind.singular} added`);
					onPanel({});
				}}
			/>
			<ShareDialog
				pouchId={pouch.id}
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
					if (search.item === deleting.id) onPanel({});
					toast.success(`${deleting.name} deleted`);
				}}
			/>
		</>
	);
}
