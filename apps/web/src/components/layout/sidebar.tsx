// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The navigation column. Generic: callers pass sections of links and an
 * optional pinned footer, so the pouch area and the account area share it.
 * Collapsed, it shows icons only with tooltips.
 */
import { Link, useMatchRoute } from '@tanstack/react-router';
import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { Logo } from '@/components/brand/logo';
import { Tooltip } from '@/components/ui/tooltip';
import { cn } from '@/lib/cn';

export interface NavItem {
	to: string;
	params?: Record<string, string>;
	label: string;
	icon: LucideIcon;
	count?: number;
	/** Active only on an exact match (overview pages). */
	exact?: boolean;
}

export interface NavSection {
	id: string;
	label?: string;
	items: NavItem[];
}

export interface SidebarProps {
	sections: NavSection[];
	/** Pushed to the bottom (Shared links, settings, Connect CLI). */
	footer?: ReactNode;
	collapsed?: boolean;
	onNavigate?: () => void;
	/** Header slot right of the logo (close button in the mobile drawer). */
	headerAside?: ReactNode;
}

export function Sidebar({
	sections,
	footer,
	collapsed = false,
	onNavigate,
	headerAside,
}: SidebarProps) {
	return (
		<nav aria-label="Main" className="flex h-full flex-col gap-4 px-3 pb-4">
			{/* Same height and inset as the top bar (h-14, 24 px), so the logo never shifts between pages. */}
			{/* Collapsing only clips and fades the text; the icons keep their place. */}
			<div
				className={cn(
					'flex h-14 shrink-0 items-center justify-between overflow-hidden border-b border-transparent whitespace-nowrap transition-[padding] duration-200',
					collapsed ? 'px-2' : 'px-3',
				)}
			>
				<Link to="/app" onClick={onNavigate} aria-label="All pouches">
					<Logo />
				</Link>
				{headerAside}
			</div>
			<div className="flex min-h-0 flex-1 flex-col gap-4 overflow-x-hidden overflow-y-auto">
				{sections.map((section) => (
					<div key={section.id} className="flex flex-col gap-0.5">
						{section.label ? (
							<p
								className={cn(
									'px-2.5 pb-1 text-xs whitespace-nowrap text-meta transition-opacity duration-200',
									collapsed && 'opacity-0',
								)}
								aria-hidden={collapsed || undefined}
							>
								{section.label}
							</p>
						) : null}
						{section.items.map((item) => (
							<SidebarLink
								key={item.to + JSON.stringify(item.params ?? {})}
								item={item}
								collapsed={collapsed}
								{...(onNavigate ? { onNavigate } : {})}
							/>
						))}
					</div>
				))}
			</div>
			{footer ? <div className="flex shrink-0 flex-col gap-0.5">{footer}</div> : null}
		</nav>
	);
}

export function SidebarLink({
	item,
	collapsed,
	onNavigate,
}: {
	item: NavItem;
	collapsed: boolean;
	onNavigate?: (() => void) | undefined;
}) {
	const matchRoute = useMatchRoute();
	const active = Boolean(
		matchRoute({
			to: item.to,
			...(item.params ? { params: item.params } : {}),
			fuzzy: !item.exact,
		}),
	);
	const Icon = item.icon;
	const link = (
		<Link
			to={item.to}
			{...(item.params ? { params: item.params } : {})}
			onClick={onNavigate}
			aria-current={active ? 'page' : undefined}
			className={cn(
				'group relative flex h-8 items-center gap-2.5 rounded-md px-2.5 text-[13px] whitespace-nowrap transition-colors max-md:h-11',
				active ? 'bg-hover/60 text-fg' : 'text-muted hover:bg-hover/40 hover:text-fg',
			)}
		>
			{active ? (
				<span
					className="absolute top-1.5 bottom-1.5 -left-3 w-0.5 rounded-r bg-accent"
					aria-hidden
				/>
			) : null}
			<Icon className="size-4 shrink-0" aria-hidden />
			<span className={cn('flex min-w-0 flex-1 items-center gap-2.5', fade(collapsed))}>
				<span className="flex-1 truncate">{item.label}</span>
				{item.count !== undefined ? (
					<span className="font-mono text-[11px] text-meta">{item.count}</span>
				) : null}
			</span>
		</Link>
	);
	return collapsed ? <Tooltip content={item.label}>{link}</Tooltip> : link;
}

/** A sidebar-styled button (Connect CLI, Collapse). */
export function SidebarButton({
	icon: Icon,
	label,
	onClick,
	collapsed,
	emphasis = false,
	trailing,
}: {
	icon: LucideIcon;
	label: string;
	onClick: () => void;
	collapsed: boolean;
	emphasis?: boolean;
	trailing?: ReactNode;
}) {
	const button = (
		<button
			type="button"
			onClick={onClick}
			className={cn(
				'flex h-9 w-full items-center gap-2.5 overflow-hidden rounded-md text-[13px] whitespace-nowrap transition-colors max-md:h-11',
				// The border takes a pixel, so the icon lines up with the links above.
				emphasis
					? 'border border-border-strong bg-surface px-[9px] font-medium text-fg hover:bg-hover'
					: 'px-2.5 text-muted hover:bg-hover/40 hover:text-fg',
			)}
		>
			<Icon className="size-4 shrink-0" aria-hidden />
			<span className={cn('flex min-w-0 flex-1 items-center gap-2.5', fade(collapsed))}>
				<span className="flex-1 truncate text-left">{label}</span>
				{trailing}
			</span>
		</button>
	);
	return collapsed ? <Tooltip content={label}>{button}</Tooltip> : button;
}

/** Labels stay mounted while collapsed: clipped by the narrow column and faded out. */
function fade(collapsed: boolean) {
	return cn('transition-opacity duration-200', collapsed && 'opacity-0');
}
