// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `/pouches/:pouchId/trash` — deleted items, restorable for 7 days. Restoring
 * over a name a live item took in the meantime asks for a new name first.
 */
import { useParams } from '@tanstack/react-router';
import { Ellipsis, Trash2, Undo2 } from 'lucide-react';
import { useState } from 'react';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { EmptyState } from '@/components/ui/empty-state';
import { ErrorMessage } from '@/components/ui/error-message';
import { PageSkeleton } from '@/components/ui/page-skeleton';
import { PromptDialog } from '@/components/ui/prompt-dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from '@/components/ui/toast';
import { usePouchContents, nameTaken, type Ingredient } from '@/features/ingredients/ingredients';
import { kindDefinition } from '@/features/ingredients/kinds';
import { usePouch } from '@/features/pouches/pouches';
import {
	removalDate,
	restoreNameProblem,
	suggestRestoreName,
	useDeletePermanently,
	useRestoreIngredient,
} from '@/features/trash/trash';
import { describeError } from '@/lib/api/errors';
import { formatBytes, formatRelative, formatTimeLeft, plural } from '@/lib/format';

function timeLeft(item: Ingredient): string {
	const removal = removalDate(item);
	return removal.getTime() > Date.now() ? formatTimeLeft(removal) : 'soon';
}

function TrashMenu({
	item,
	onRestore,
	onDelete,
	busy,
}: {
	item: Ingredient;
	onRestore: (item: Ingredient) => void;
	onDelete: (item: Ingredient) => void;
	busy: boolean;
}) {
	return (
		<DropdownMenu>
			<DropdownMenuTrigger
				aria-label={`Actions for ${item.name}`}
				className="rounded-md p-1.5 text-muted hover:bg-hover hover:text-fg max-sm:p-2.5"
			>
				<Ellipsis className="size-4" />
			</DropdownMenuTrigger>
			<DropdownMenuContent>
				<DropdownMenuItem disabled={busy} onSelect={() => onRestore(item)}>
					<Undo2 /> Restore
				</DropdownMenuItem>
				<DropdownMenuSeparator />
				<DropdownMenuItem tone="danger" onSelect={() => onDelete(item)}>
					<Trash2 /> Delete permanently
				</DropdownMenuItem>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}

export function TrashPage() {
	const { pouchId } = useParams({ strict: false }) as { pouchId: string };
	const pouch = usePouch(pouchId).data;
	const contents = usePouchContents(pouchId);
	const [renaming, setRenaming] = useState<Ingredient | null>(null);
	const [removing, setRemoving] = useState<Ingredient[] | null>(null);
	const restore = useRestoreIngredient(pouch ?? { id: pouchId, epoch: '' });
	const remove = useDeletePermanently(pouch ?? { id: pouchId, epoch: '' });

	if (!pouch) return <PageSkeleton variant="list" />;
	const readOnly = pouch.state !== 'active';
	const live = contents.data?.ingredients ?? [];
	const items = contents.data?.trash ?? [];

	const restoreAs = (item: Ingredient, name: string) =>
		restore.mutate(
			{ item, name },
			{
				onSuccess: () =>
					toast.success(
						name === item.name
							? `${name} restored`
							: `${item.name} restored as ${name}`,
					),
				onError: (error) => toast.error(describeError(error)),
			},
		);
	const startRestore = (item: Ingredient) => {
		if (nameTaken(live, item.kind, item.name, item.id)) setRenaming(item);
		else restoreAs(item, item.name);
	};
	const renamingKind = renaming ? kindDefinition(renaming.kind) : undefined;
	const menu = {
		onRestore: startRestore,
		onDelete: (item: Ingredient) => setRemoving([item]),
		busy: restore.isPending,
	};

	return (
		<>
			<PageHeader
				title="Trash"
				description="Deleted items stay here for 7 days. After that their files are removed for good."
				actions={
					readOnly || items.length === 0 ? null : (
						<Button variant="danger-outline" onClick={() => setRemoving(items)}>
							<Trash2 /> Empty trash
						</Button>
					)
				}
			/>
			<ErrorMessage error={contents.error} className="mb-4" />
			{contents.isPending ? (
				<div className="flex flex-col gap-2" aria-busy>
					{Array.from({ length: 3 }, (_, index) => (
						<Skeleton key={index} className="h-14" />
					))}
				</div>
			) : items.length === 0 ? (
				<EmptyState
					icon={Trash2}
					title="Trash is empty"
					description="Items you delete show up here for 7 days, so you can bring them back."
				/>
			) : (
				<>
					<table className="hidden w-full table-fixed border-collapse text-[13px] md:table">
						<thead>
							<tr className="border-b border-border text-left text-xs whitespace-nowrap text-meta">
								<th className="w-[28%] py-2.5 pr-4 font-normal">Name</th>
								<th className="py-2.5 pr-4 font-normal">Type</th>
								<th className="w-14 py-2.5 pr-4 font-normal">Files</th>
								<th className="w-24 py-2.5 pr-4 font-normal">Size</th>
								<th className="w-36 py-2.5 pr-4 font-normal">Deleted</th>
								<th className="w-36 py-2.5 pr-4 font-normal">Removed in</th>
								<th className="w-12 py-2.5 font-normal">
									<span className="sr-only">Actions</span>
								</th>
							</tr>
						</thead>
						<tbody>
							{items.map((item) => (
								<tr
									key={item.id}
									className="border-b border-border-soft whitespace-nowrap"
								>
									<td className="truncate py-3 pr-4 font-mono text-fg">
										{item.name}
									</td>
									<td className="truncate py-3 pr-4 text-muted">
										{kindDefinition(item.kind)?.singular ?? ''}
									</td>
									<td className="truncate py-3 pr-4 font-mono text-muted">
										{item.files.length}
									</td>
									<td className="truncate py-3 pr-4 font-mono text-muted">
										{formatBytes(item.size)}
									</td>
									<td className="truncate py-3 pr-4 text-muted">
										{formatRelative(item.deletedAt)}
									</td>
									<td className="truncate py-3 pr-4 text-muted">
										{timeLeft(item)}
									</td>
									<td className="py-3 text-right">
										{readOnly ? null : <TrashMenu item={item} {...menu} />}
									</td>
								</tr>
							))}
						</tbody>
					</table>
					<ul className="flex flex-col md:hidden">
						{items.map((item) => (
							<li
								key={item.id}
								className="flex items-center gap-3 border-b border-border-soft py-3"
							>
								<div className="flex min-w-0 flex-1 flex-col gap-1">
									<span className="truncate font-mono text-sm text-fg">
										{item.name}
									</span>
									<span className="flex flex-wrap items-center gap-x-2 text-xs text-meta">
										{kindDefinition(item.kind)?.singular ?? ''} ·{' '}
										{plural(item.files.length, 'file')} ·{' '}
										{formatBytes(item.size)} · Deleted{' '}
										{formatRelative(item.deletedAt)} · Removed in{' '}
										{timeLeft(item)}
									</span>
								</div>
								{readOnly ? null : <TrashMenu item={item} {...menu} />}
							</li>
						))}
					</ul>
				</>
			)}

			<PromptDialog
				open={renaming !== null}
				onOpenChange={(open) => !open && setRenaming(null)}
				title={`Restore ${renaming?.name ?? ''}`}
				description={`A ${renamingKind?.singular.toLowerCase() ?? 'item'} called “${renaming?.name ?? ''}” already exists. Pick a new name for the one you restore.`}
				label="Name"
				initialValue={renaming ? suggestRestoreName(live, renaming) : ''}
				submitLabel="Restore"
				validate={(name) => (renaming ? restoreNameProblem(live, renaming, name) : null)}
				onSubmit={(name) => renaming && restoreAs(renaming, name)}
			/>
			<ConfirmDialog
				open={removing !== null}
				onOpenChange={(open) => !open && setRemoving(null)}
				title={
					removing?.length === 1
						? `Delete ${removing[0]!.name} permanently?`
						: `Delete ${plural(removing?.length ?? 0, 'item')} permanently?`
				}
				description={
					removing?.length === 1
						? 'Its files are removed now. It can’t be restored afterwards.'
						: 'Their files are removed now. They can’t be restored afterwards.'
				}
				confirmLabel="Delete permanently"
				onConfirm={async () => {
					if (!removing) return;
					await remove.mutateAsync(removing);
					toast.success(
						removing.length === 1
							? `${removing[0]!.name} deleted permanently`
							: `${plural(removing.length, 'item')} deleted permanently`,
					);
				}}
			/>
		</>
	);
}
