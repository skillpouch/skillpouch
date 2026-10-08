// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Pick a marketplace, search it, preview an item and add it to the pouch.
 *
 *  - `page`: marketplace rail on the left, results on the right (Marketplaces page);
 *  - `compact`: a marketplace dropdown above the results ("Add …" dialogs,
 *    filtered to one kind).
 *
 * Items that run commands (MCP servers) always open the preview first.
 */
import { Search, X } from 'lucide-react';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { ErrorMessage } from '@/components/ui/error-message';
import { Input } from '@/components/ui/input';
import { Segmented } from '@/components/ui/segmented';
import { Skeleton } from '@/components/ui/skeleton';
import { kindDefinition, type KindDefinition } from '@/features/ingredients/kinds';
import { useInvalidateContents } from '@/features/ingredients/mutations';
import type { PouchView } from '@/features/pouches/pouches';
import { describeError } from '@/lib/api/errors';
import { cn } from '@/lib/cn';
import {
	addItemToPouch,
	fetchMarketplaceItem,
	hasLeaderboard,
	offering,
	searchesRemotely,
	useMarketplaceItems,
	useMarketplaces,
	type ItemSort,
	type Marketplace,
	type MarketplaceItem,
	type MarketplaceItemContent,
} from '../marketplaces';
import { GithubAccessCard } from './github-access-card';
import { ItemGrid } from './item-grid';
import { ItemPreview } from './item-preview';
import { MarketplaceIcon } from './marketplace-icon';
import { MarketplacePicker, MarketplaceRail } from './marketplace-rail';

const SORTS: { value: ItemSort; label: string }[] = [
	{ value: 'popular', label: 'Most installed' },
	{ value: 'trending', label: 'Trending' },
];

const count = new Intl.NumberFormat('en');

export interface MarketplaceBrowserProps {
	pouch: PouchView;
	layout?: 'page' | 'compact';
	/** Only marketplaces and items of this kind. */
	kind?: KindDefinition | undefined;
	/** Controlled selection (the page keeps it in the URL). */
	marketplaceId?: string | undefined;
	onMarketplaceChange?: (id: string) => void;
	/** Opens "Add marketplace", on its private-repository tab when asked. */
	onAddMarketplace?: (tab?: 'public' | 'private') => void;
	/** Buttons beside the selected marketplace's name (open, remove). */
	actions?: (marketplace: Marketplace) => ReactNode;
	onAdded?: (result: { name: string; kind: KindDefinition }) => void;
}

export function MarketplaceBrowser({
	pouch,
	layout = 'page',
	kind,
	marketplaceId,
	onMarketplaceChange,
	onAddMarketplace,
	actions,
	onAdded,
}: MarketplaceBrowserProps) {
	const list = useMarketplaces();
	const available = useMemo(
		() => (list.data ? offering(list.data.marketplaces, kind?.kind) : undefined),
		[list.data, kind],
	);
	const [ownSelection, setOwnSelection] = useState<string | undefined>();
	const selectedId = marketplaceId ?? ownSelection;
	const marketplace = available?.find((entry) => entry.id === selectedId) ?? available?.[0];
	const [query, setQuery] = useState('');
	const [sort, setSort] = useState<ItemSort>('popular');
	const [preview, setPreview] = useState<MarketplaceItem | null>(null);
	const adding = useAddItem(pouch, onAdded);
	const canAdd = pouch.state === 'active';

	const select = (id: string) => {
		setOwnSelection(id);
		onMarketplaceChange?.(id);
		setPreview(null);
		setQuery('');
	};

	if (list.error) return <ErrorMessage error={list.error} />;

	const picker = available ? (
		<MarketplacePicker
			marketplaces={available}
			selected={marketplace}
			onSelect={select}
			onAdd={onAddMarketplace ? () => onAddMarketplace() : undefined}
			className={layout === 'page' ? 'w-full md:hidden' : 'w-full sm:w-60 sm:shrink-0'}
		/>
	) : (
		<Skeleton className={cn('h-10', layout === 'page' ? 'md:hidden' : 'sm:w-60')} />
	);

	const body = !available ? (
		<BodySkeleton />
	) : !marketplace ? (
		<p className="py-10 text-center text-[13px] text-muted">
			No marketplace offers {kind ? kind.label.toLowerCase() : 'anything'} yet.
		</p>
	) : preview ? (
		<ItemPreview
			marketplace={marketplace}
			item={preview}
			canAdd={canAdd}
			busy={adding.busyKey === preview.key}
			disabled={adding.busyKey !== null}
			onAdd={(content) => void adding.add(marketplace, preview.key, content)}
			onBack={() => setPreview(null)}
		/>
	) : (
		<Results
			key={marketplace.id}
			marketplace={marketplace}
			layout={layout}
			picker={layout === 'compact' ? picker : null}
			kind={kind}
			query={query}
			onQuery={setQuery}
			sort={sort}
			onSort={setSort}
			actions={actions}
			canAdd={canAdd}
			busyKey={adding.busyKey}
			onOpen={setPreview}
			onAdd={(item) => void adding.add(marketplace, item.key)}
		/>
	);

	if (layout === 'compact') return <div className="flex min-h-0 flex-col gap-4">{body}</div>;

	return (
		<div className="grid gap-6 md:grid-cols-[220px_minmax(0,1fr)] md:gap-8">
			<MarketplaceRail
				className="hidden self-start md:sticky md:top-0 md:flex md:max-h-[calc(100dvh-8rem)]"
				marketplaces={available}
				selectedId={marketplace?.id}
				onSelect={select}
				onAdd={() => onAddMarketplace?.()}
				footer={
					list.data ? (
						<GithubAccessCard
							github={list.data.github}
							onAddPrivate={() => onAddMarketplace?.('private')}
							className="mt-2"
						/>
					) : null
				}
			/>
			<div className="flex min-w-0 flex-col gap-5">
				{picker}
				{body}
			</div>
		</div>
	);
}

function Results({
	marketplace,
	layout,
	picker,
	kind,
	query,
	onQuery,
	sort,
	onSort,
	actions,
	canAdd,
	busyKey,
	onOpen,
	onAdd,
}: {
	marketplace: Marketplace;
	layout: 'page' | 'compact';
	picker: ReactNode;
	kind: KindDefinition | undefined;
	query: string;
	onQuery: (query: string) => void;
	sort: ItemSort;
	onSort: (sort: ItemSort) => void;
	actions: MarketplaceBrowserProps['actions'];
	canAdd: boolean;
	busyKey: string | null;
	onOpen: (item: MarketplaceItem) => void;
	onAdd: (item: MarketplaceItem) => void;
}) {
	const debounced = useDebounced(query, searchesRemotely(marketplace) ? 400 : 150);
	const items = useMarketplaceItems(marketplace, debounced, kind?.kind, sort);
	const leaderboard = hasLeaderboard(marketplace) && debounced.trim().length < 2;
	const total = items.data?.pages[0]?.total ?? null;

	return (
		<>
			{layout === 'page' ? (
				<MarketplaceHeader
					marketplace={marketplace}
					total={leaderboard || !debounced.trim() ? total : null}
					actions={actions?.(marketplace)}
				/>
			) : null}
			<div className="flex flex-col gap-2 sm:flex-row sm:items-center">
				{picker}
				<div className="relative min-w-0 flex-1">
					<Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-meta" />
					<Input
						aria-label={`Search ${marketplace.name}`}
						placeholder={`Search ${marketplace.name}`}
						value={query}
						onChange={(event) => onQuery(event.target.value)}
						className="h-10 pr-9 pl-9"
					/>
					{query ? (
						<button
							type="button"
							aria-label="Clear search"
							onClick={() => onQuery('')}
							className="absolute top-1/2 right-2 flex size-6 -translate-y-1/2 cursor-pointer items-center justify-center rounded text-meta hover:bg-hover hover:text-fg"
						>
							<X className="size-3.5" />
						</button>
					) : null}
				</div>
				{leaderboard ? (
					<Segmented
						label="Sort skills.sh"
						value={sort}
						onChange={onSort}
						options={SORTS}
						className="sm:h-10 sm:items-center"
					/>
				) : null}
			</div>
			<ItemGrid
				items={items}
				waiting={query.trim() !== debounced.trim()}
				ranked={leaderboard && sort === 'popular'}
				showKind={!kind && marketplace.kinds.length > 1}
				query={debounced}
				canAdd={canAdd}
				busyKey={busyKey}
				onOpen={onOpen}
				onAdd={onAdd}
			/>
		</>
	);
}

function MarketplaceHeader({
	marketplace,
	total,
	actions,
}: {
	marketplace: Marketplace;
	total: number | null;
	actions: ReactNode;
}) {
	const kinds = marketplace.kinds.map((kind) => kindDefinition(kind));
	const noun = kinds.length === 1 && kinds[0] ? kinds[0].label.toLowerCase() : 'items';
	return (
		<header className="flex flex-col gap-4 border-b border-border pb-5 sm:flex-row sm:items-start sm:justify-between">
			<div className="flex min-w-0 items-start gap-3">
				<MarketplaceIcon marketplace={marketplace} className="size-10 [&_svg]:size-5" />
				<div className="flex min-w-0 flex-col gap-1">
					<div className="flex min-w-0 items-center gap-2">
						<h2 className="truncate text-lg font-semibold tracking-tight">
							{marketplace.name}
						</h2>
						{marketplace.private ? <Badge>Private</Badge> : null}
					</div>
					<p className="text-[13px] text-muted">
						{marketplace.description ?? marketplace.repo}
					</p>
					<p className="text-xs text-meta">
						{total !== null
							? `${count.format(total)} ${noun}`
							: kinds.map((kind) => kind?.label).join(', ')}
					</p>
				</div>
			</div>
			{actions ? <div className="flex shrink-0 items-center gap-1">{actions}</div> : null}
		</header>
	);
}

function BodySkeleton() {
	return (
		<div className="flex flex-col gap-5" aria-label="Loading" role="status">
			<div className="flex items-start gap-3 border-b border-border pb-5">
				<Skeleton className="size-10" />
				<div className="flex flex-1 flex-col gap-2 pt-1">
					<Skeleton className="h-4 w-40" />
					<Skeleton className="h-3 w-64" />
				</div>
			</div>
			<Skeleton className="h-10 w-full" />
		</div>
	);
}

/** Adds one item; remembers which one is in flight. */
function useAddItem(pouch: PouchView, onAdded: MarketplaceBrowserProps['onAdded']) {
	const invalidate = useInvalidateContents(pouch.id);
	const [busyKey, setBusyKey] = useState<string | null>(null);
	const add = async (marketplace: Marketplace, key: string, content?: MarketplaceItemContent) => {
		setBusyKey(key);
		try {
			const item = content ?? (await fetchMarketplaceItem(marketplace.id, key));
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
	return { busyKey, add };
}

function useDebounced(value: string, delay: number): string {
	const [current, setCurrent] = useState(value);
	useEffect(() => {
		const timer = setTimeout(() => setCurrent(value), delay);
		return () => clearTimeout(timer);
	}, [value, delay]);
	return current;
}
