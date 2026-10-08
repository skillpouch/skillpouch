// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A marketplace's items as cards. More load as you scroll; while a search
 * runs, card-shaped skeletons stand in for the results.
 */
import { Check, Download, SearchX } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { ErrorMessage } from '@/components/ui/error-message';
import { Skeleton } from '@/components/ui/skeleton';
import type { Ingredient } from '@/features/ingredients/ingredients';
import { kindDefinition } from '@/features/ingredients/kinds';
import { cn } from '@/lib/cn';
import { useOnVisible } from '@/lib/use-on-visible';
import type { MarketplaceItem, useMarketplaceItems } from '../marketplaces';

const compact = new Intl.NumberFormat('en', { notation: 'compact' });

/** Columns follow the space the grid gets, so it works in a page and a dialog. */
const GRID = 'grid gap-3 @xl:grid-cols-2 @4xl:grid-cols-3';

export interface ItemGridProps {
	items: ReturnType<typeof useMarketplaceItems>;
	/** Show placeholders instead of results (a search is about to run). */
	waiting: boolean;
	/** Number the cards: the list is a leaderboard. */
	ranked: boolean;
	/** Show each card's kind (the list mixes kinds). */
	showKind: boolean;
	query: string;
	canAdd: boolean;
	busyKey: string | null;
	/** What the pouch already has of an item. */
	installed: (item: MarketplaceItem) => Ingredient | undefined;
	onOpen: (item: MarketplaceItem) => void;
	onAdd: (item: MarketplaceItem) => void;
	onRemove: (item: MarketplaceItem, ingredient: Ingredient) => void;
}

export function ItemGrid({
	items,
	waiting,
	ranked,
	showKind,
	query,
	canAdd,
	busyKey,
	installed,
	onOpen,
	onAdd,
	onRemove,
}: ItemGridProps) {
	const results = items.data?.pages.flatMap((page) => page.items) ?? [];
	const sentinel = useOnVisible<HTMLDivElement>(() => void items.fetchNextPage(), {
		enabled: items.hasNextPage && !items.isFetchingNextPage && !items.isFetchNextPageError,
		key: results.length,
	});

	if (waiting || items.isPending) return <ItemGridSkeleton count={9} label="Searching" />;
	if (items.error && results.length === 0) return <ErrorMessage error={items.error} />;
	if (results.length === 0) {
		return (
			<EmptyState
				icon={SearchX}
				title={query.trim() ? `Nothing found for “${query.trim()}”` : 'Nothing here yet'}
				description={query.trim() ? 'Try another word, or another marketplace.' : undefined}
			/>
		);
	}

	return (
		<div className="@container flex flex-col gap-3">
			<ul className={GRID} aria-label="Results">
				{results.map((item, index) => {
					const ingredient = installed(item);
					return (
						<ItemCard
							key={`${item.kind}:${item.key}`}
							item={item}
							rank={ranked ? index + 1 : null}
							showKind={showKind}
							canAdd={canAdd}
							installed={ingredient !== undefined}
							busy={busyKey === item.key}
							disabled={busyKey !== null}
							onOpen={() => onOpen(item)}
							onAdd={() => onAdd(item)}
							onRemove={() => ingredient && onRemove(item, ingredient)}
						/>
					);
				})}
			</ul>
			{items.isFetchingNextPage ? <ItemGridSkeleton count={3} label="Loading more" /> : null}
			{items.isFetchNextPageError ? (
				<div className="flex items-center justify-center gap-3 py-4 text-[13px] text-muted">
					Couldn’t load more.
					<Button size="sm" variant="outline" onClick={() => void items.fetchNextPage()}>
						Try again
					</Button>
				</div>
			) : null}
			<div ref={sentinel} aria-hidden />
			{!items.hasNextPage && results.length > 12 ? (
				<p className="py-4 text-center text-xs text-meta">That’s everything.</p>
			) : null}
		</div>
	);
}

function ItemCard({
	item,
	rank,
	showKind,
	canAdd,
	installed,
	busy,
	disabled,
	onOpen,
	onAdd,
	onRemove,
}: {
	item: MarketplaceItem;
	rank: number | null;
	showKind: boolean;
	canAdd: boolean;
	installed: boolean;
	busy: boolean;
	disabled: boolean;
	onOpen: () => void;
	onAdd: () => void;
	onRemove: () => void;
}) {
	const definition = kindDefinition(item.kind);
	const Icon = definition?.icon;
	const review = definition?.runsCommands === true;

	return (
		<li className="group relative flex h-full flex-col gap-3 rounded-lg border border-border bg-surface/40 p-4 transition-colors hover:border-border-strong hover:bg-hover/40">
			<div className="flex items-start gap-3">
				<span
					aria-hidden
					className="flex size-9 shrink-0 items-center justify-center rounded-md border border-border bg-bg text-muted [&_svg]:size-4"
				>
					{Icon ? <Icon /> : null}
				</span>
				<div className="flex min-w-0 flex-1 flex-col">
					<button
						type="button"
						onClick={onOpen}
						className="cursor-pointer truncate text-left text-[13px] font-medium text-fg after:absolute after:inset-0 after:rounded-lg after:content-[''] focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-accent/60"
					>
						{item.name}
					</button>
					<span className="truncate text-xs text-meta">{item.repo ?? '\u00a0'}</span>
				</div>
				{rank !== null ? (
					<span className="shrink-0 font-mono text-[11px] text-meta tabular-nums">
						#{rank}
					</span>
				) : null}
			</div>
			<p
				className={cn(
					'line-clamp-2 min-h-[2lh] text-xs leading-relaxed',
					item.description ? 'text-muted' : 'text-meta',
				)}
			>
				{item.description ?? 'No description.'}
			</p>
			<div className="mt-auto flex items-center gap-2">
				{showKind && definition ? <Badge>{definition.singular}</Badge> : null}
				{item.installs ? (
					<span className="flex items-center gap-1 text-xs text-meta tabular-nums">
						<Download className="size-3" aria-hidden />
						{compact.format(item.installs)}
						<span className="sr-only">installs</span>
					</span>
				) : null}
				{installed ? <InstalledMark className="ml-auto" /> : null}
				{canAdd && installed ? (
					<Button
						size="sm"
						variant="ghost"
						className="relative z-10 text-muted hover:text-danger"
						aria-label={`Remove ${item.name}`}
						loading={busy}
						disabled={disabled}
						onClick={onRemove}
					>
						Remove
					</Button>
				) : null}
				{canAdd && !installed ? (
					<Button
						size="sm"
						variant="outline"
						className="relative z-10 ml-auto"
						aria-label={`${review ? 'Review' : 'Add'} ${item.name}`}
						loading={busy}
						disabled={disabled}
						onClick={review ? onOpen : onAdd}
					>
						{review ? 'Review' : 'Add'}
					</Button>
				) : null}
			</div>
		</li>
	);
}

export function InstalledMark({ className }: { className?: string }) {
	return (
		<span
			className={cn(
				'flex items-center gap-1 text-xs font-medium text-success [&_svg]:size-3.5',
				className,
			)}
		>
			<Check aria-hidden /> Installed
		</span>
	);
}

export function ItemGridSkeleton({ count, label }: { count: number; label: string }) {
	return (
		<div className="@container" aria-label={label} role="status">
			<div className={GRID}>
				{Array.from({ length: count }, (_, index) => (
					<div
						key={index}
						className="flex flex-col gap-3 rounded-lg border border-border p-4"
					>
						<div className="flex items-start gap-3">
							<Skeleton className="size-9" />
							<div className="flex flex-1 flex-col gap-1.5 pt-0.5">
								<Skeleton className="h-3.5 w-2/5" />
								<Skeleton className="h-3 w-1/3" />
							</div>
						</div>
						<div className="flex flex-col gap-1.5">
							<Skeleton className="h-3 w-full" />
							<Skeleton className="h-3 w-3/4" />
						</div>
						<div className="flex items-center justify-between pt-1">
							<Skeleton className="h-3 w-12" />
							<Skeleton className="h-7 w-14" />
						</div>
					</div>
				))}
			</div>
		</div>
	);
}
