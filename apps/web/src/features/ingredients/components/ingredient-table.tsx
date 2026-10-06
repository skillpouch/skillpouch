// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The list every ingredient type uses: a table on desktop, stacked rows on
 * phones. Row actions live in one ⋯ menu.
 */
import { Ellipsis, Eye, Pencil, Share2, Trash2 } from 'lucide-react';
import type { ReactNode } from 'react';
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Skeleton } from '@/components/ui/skeleton';
import { StatusDot } from '@/components/ui/status-dot';
import { formatBytes, formatRelative, plural } from '@/lib/format';
import type { Ingredient } from '../ingredients';

export interface IngredientRowActions {
	onShow: (ingredient: Ingredient) => void;
	onEdit: (ingredient: Ingredient) => void;
	onShare: (ingredient: Ingredient) => void;
	onDelete: (ingredient: Ingredient) => void;
}

export interface IngredientTableProps extends IngredientRowActions {
	items: Ingredient[];
	descriptions: Map<string, string> | undefined;
	conflicted: Set<string>;
	readOnly: boolean;
	loading: boolean;
}

function SyncCell({ conflicted }: { conflicted: boolean }) {
	return conflicted ? (
		<StatusDot tone="error" label="Conflict" />
	) : (
		<StatusDot tone="ok" label="Synced" />
	);
}

function RowMenu({
	ingredient,
	readOnly,
	...actions
}: IngredientRowActions & { ingredient: Ingredient; readOnly: boolean }) {
	return (
		<DropdownMenu>
			<DropdownMenuTrigger
				aria-label={`Actions for ${ingredient.name}`}
				className="rounded-md p-1.5 text-muted hover:bg-hover hover:text-fg max-sm:p-2.5"
			>
				<Ellipsis className="size-4" />
			</DropdownMenuTrigger>
			<DropdownMenuContent>
				<DropdownMenuItem onSelect={() => actions.onShow(ingredient)}>
					<Eye /> Show
				</DropdownMenuItem>
				{readOnly ? null : (
					<>
						<DropdownMenuItem onSelect={() => actions.onEdit(ingredient)}>
							<Pencil /> Edit
						</DropdownMenuItem>
						<DropdownMenuItem onSelect={() => actions.onShare(ingredient)}>
							<Share2 /> Share
						</DropdownMenuItem>
					</>
				)}
				<DropdownMenuSeparator />
				<DropdownMenuItem tone="danger" onSelect={() => actions.onDelete(ingredient)}>
					<Trash2 /> Delete
				</DropdownMenuItem>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}

function Description({ value }: { value: string | undefined }): ReactNode {
	if (value === undefined) return <Skeleton className="h-3.5 w-40" />;
	return value || <span className="text-meta">—</span>;
}

export function IngredientTable(props: IngredientTableProps) {
	const { items, descriptions, conflicted, readOnly, loading } = props;
	const actions: IngredientRowActions = {
		onShow: props.onShow,
		onEdit: props.onEdit,
		onShare: props.onShare,
		onDelete: props.onDelete,
	};
	if (loading) {
		return (
			<div className="flex flex-col gap-2" aria-busy>
				{Array.from({ length: 4 }, (_, index) => (
					<Skeleton key={index} className="h-12" />
				))}
			</div>
		);
	}
	return (
		<>
			<table className="hidden w-full table-fixed border-collapse text-[13px] md:table">
				<thead>
					<tr className="border-b border-border text-left text-xs text-meta">
						<th className="w-[22%] py-2.5 pr-4 font-normal">Name</th>
						<th className="py-2.5 pr-4 font-normal">Description</th>
						<th className="w-16 py-2.5 pr-4 font-normal">Files</th>
						<th className="w-20 py-2.5 pr-4 font-normal">Size</th>
						<th className="w-28 py-2.5 pr-4 font-normal">Updated</th>
						<th className="w-24 py-2.5 pr-4 font-normal">Sync</th>
						<th className="w-12 py-2.5 font-normal">
							<span className="sr-only">Actions</span>
						</th>
					</tr>
				</thead>
				<tbody>
					{items.map((ingredient) => (
						<tr
							key={ingredient.id}
							className="group border-b border-border-soft transition-colors hover:bg-surface"
						>
							<td className="truncate py-3 pr-4">
								<button
									type="button"
									onClick={() => props.onShow(ingredient)}
									className="truncate font-mono text-fg hover:underline"
								>
									{ingredient.name}
								</button>
							</td>
							<td className="truncate py-3 pr-4 text-muted">
								<Description value={descriptions?.get(ingredient.id)} />
							</td>
							<td className="py-3 pr-4 font-mono text-muted">
								{ingredient.files.length}
							</td>
							<td className="py-3 pr-4 font-mono text-muted">
								{formatBytes(ingredient.size)}
							</td>
							<td className="py-3 pr-4 text-muted">
								{formatRelative(ingredient.updatedAt)}
							</td>
							<td className="py-3 pr-4">
								<SyncCell conflicted={conflicted.has(ingredient.id)} />
							</td>
							<td className="py-3 text-right">
								<RowMenu ingredient={ingredient} readOnly={readOnly} {...actions} />
							</td>
						</tr>
					))}
				</tbody>
			</table>
			<ul className="flex flex-col md:hidden">
				{items.map((ingredient) => (
					<li
						key={ingredient.id}
						className="flex items-center gap-3 border-b border-border-soft py-3"
					>
						<button
							type="button"
							onClick={() => props.onShow(ingredient)}
							className="flex min-w-0 flex-1 flex-col gap-1 text-left"
						>
							<span className="truncate font-mono text-sm text-fg">
								{ingredient.name}
							</span>
							<span className="truncate text-[13px] text-muted">
								<Description value={descriptions?.get(ingredient.id)} />
							</span>
							<span className="flex flex-wrap items-center gap-x-2 text-xs text-meta">
								{plural(ingredient.files.length, 'file')} ·{' '}
								{formatBytes(ingredient.size)} ·{' '}
								{formatRelative(ingredient.updatedAt)} ·{' '}
								<SyncCell conflicted={conflicted.has(ingredient.id)} />
							</span>
						</button>
						<RowMenu ingredient={ingredient} readOnly={readOnly} {...actions} />
					</li>
				))}
			</ul>
		</>
	);
}
