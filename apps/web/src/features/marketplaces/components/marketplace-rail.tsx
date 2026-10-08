// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Choosing a marketplace. On wide screens a grouped, filterable rail that
 * scrolls on its own, so twenty marketplaces fit as well as four; on phones
 * and in dialogs a dropdown with the same groups.
 */
import { Check, ChevronsUpDown, Plus, Search } from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuGroup,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { kindDefinition } from '@/features/ingredients/kinds';
import { cn } from '@/lib/cn';
import { groupMarketplaces, type Marketplace } from '../marketplaces';
import { MarketplaceIcon } from './marketplace-icon';

/** With more than this many, the rail gets a filter box. */
const FILTER_FROM = 7;

/** `anthropics/skills`, or what a directory offers: "Skills". */
export function marketplaceSubtitle(marketplace: Marketplace): string {
	if (marketplace.repo) return marketplace.repo;
	return marketplace.kinds.map((kind) => kindDefinition(kind)?.label ?? kind).join(', ');
}

export interface MarketplaceRailProps {
	marketplaces: Marketplace[] | undefined;
	selectedId: string | undefined;
	onSelect: (id: string) => void;
	onAdd: () => void;
	/** Below the list, such as the GitHub connection. */
	footer?: ReactNode;
	className?: string;
}

export function MarketplaceRail({
	marketplaces,
	selectedId,
	onSelect,
	onAdd,
	footer,
	className,
}: MarketplaceRailProps) {
	const [filter, setFilter] = useState('');
	const groups = useMemo(
		() => groupMarketplaces(marketplaces ?? [], filter),
		[marketplaces, filter],
	);

	return (
		<nav aria-label="Marketplaces" className={cn('flex min-h-0 flex-col gap-3', className)}>
			{(marketplaces?.length ?? 0) >= FILTER_FROM ? (
				<div className="relative">
					<Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-meta" />
					<Input
						aria-label="Filter marketplaces"
						placeholder="Filter marketplaces"
						value={filter}
						onChange={(event) => setFilter(event.target.value)}
						className="h-8 pl-8 text-[13px]"
					/>
				</div>
			) : null}
			<div className="-mx-1 flex min-h-0 flex-col gap-4 overflow-y-auto px-1">
				{!marketplaces ? (
					<RailSkeleton />
				) : groups.length === 0 ? (
					<p className="px-2 text-xs text-muted">No marketplace matches.</p>
				) : (
					groups.map((group) => (
						<section key={group.id} className="flex flex-col gap-0.5">
							<h2 className="px-2 pb-1 text-[11px] font-medium tracking-wide text-meta uppercase">
								{group.label}
							</h2>
							{group.marketplaces.map((entry) => (
								<RailItem
									key={entry.id}
									marketplace={entry}
									active={entry.id === selectedId}
									onSelect={() => onSelect(entry.id)}
								/>
							))}
						</section>
					))
				)}
			</div>
			<Button variant="ghost" size="sm" className="justify-start text-muted" onClick={onAdd}>
				<Plus /> Add marketplace
			</Button>
			{footer}
		</nav>
	);
}

function RailItem({
	marketplace,
	active,
	onSelect,
}: {
	marketplace: Marketplace;
	active: boolean;
	onSelect: () => void;
}) {
	return (
		<button
			type="button"
			aria-current={active ? 'page' : undefined}
			onClick={onSelect}
			className={cn(
				'flex w-full cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 text-left transition-colors',
				active ? 'bg-hover text-fg' : 'text-muted hover:bg-hover/60 hover:text-fg',
			)}
		>
			<MarketplaceIcon marketplace={marketplace} />
			<span className="flex min-w-0 flex-col">
				<span className="truncate text-[13px] font-medium">{marketplace.name}</span>
				<span className="truncate text-[11px] text-meta">
					{marketplaceSubtitle(marketplace)}
				</span>
			</span>
		</button>
	);
}

function RailSkeleton() {
	return (
		<div className="flex flex-col gap-1" aria-label="Loading marketplaces">
			<Skeleton className="mx-2 mb-1 h-3 w-20" />
			{[0, 1, 2, 3].map((index) => (
				<div key={index} className="flex items-center gap-2.5 px-2 py-1.5">
					<Skeleton className="size-7" />
					<div className="flex flex-1 flex-col gap-1.5">
						<Skeleton className="h-3 w-24" />
						<Skeleton className="h-2.5 w-16" />
					</div>
				</div>
			))}
		</div>
	);
}

/** The same choice as a dropdown, for phones and dialogs. */
export function MarketplacePicker({
	marketplaces,
	selected,
	onSelect,
	onAdd,
	className,
}: {
	marketplaces: Marketplace[];
	selected: Marketplace | undefined;
	onSelect: (id: string) => void;
	onAdd?: (() => void) | undefined;
	className?: string;
}) {
	const groups = groupMarketplaces(marketplaces);
	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<button
					type="button"
					aria-label="Choose marketplace"
					className={cn(
						'flex h-10 min-w-0 cursor-pointer items-center gap-2.5 rounded-md border border-border bg-surface px-2 text-left hover:bg-hover',
						className,
					)}
				>
					{selected ? (
						<>
							<MarketplaceIcon marketplace={selected} className="size-6" />
							<span className="min-w-0 flex-1 truncate text-[13px] font-medium text-fg">
								{selected.name}
							</span>
						</>
					) : (
						<span className="flex-1 text-[13px] text-muted">Choose a marketplace</span>
					)}
					<ChevronsUpDown className="size-3.5 shrink-0 text-meta" />
				</button>
			</DropdownMenuTrigger>
			<DropdownMenuContent
				align="start"
				className="max-h-[min(60dvh,420px)] w-[var(--radix-dropdown-menu-trigger-width)] min-w-64 overflow-y-auto"
			>
				{groups.map((group, index) => (
					<DropdownMenuGroup key={group.id}>
						{index > 0 ? <DropdownMenuSeparator /> : null}
						<DropdownMenuLabel>{group.label}</DropdownMenuLabel>
						{group.marketplaces.map((entry) => (
							<DropdownMenuItem key={entry.id} onSelect={() => onSelect(entry.id)}>
								<MarketplaceIcon marketplace={entry} className="size-6" />
								<span className="min-w-0 flex-1 truncate">{entry.name}</span>
								{entry.id === selected?.id ? <Check className="text-fg" /> : null}
							</DropdownMenuItem>
						))}
					</DropdownMenuGroup>
				))}
				{onAdd ? (
					<>
						<DropdownMenuSeparator />
						<DropdownMenuItem onSelect={onAdd}>
							<Plus /> Add marketplace
						</DropdownMenuItem>
					</>
				) : null}
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
