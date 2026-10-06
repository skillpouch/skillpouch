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
		<nav aria-label="Main" className="flex h-full flex-col gap-4 px-3 py-4">
			<div
				className={cn('flex h-8 items-center justify-between', collapsed ? 'px-1' : 'px-2')}
			>
				<Link to="/app" onClick={onNavigate} aria-label="All pouches">
					<Logo withWordmark={!collapsed} />
				</Link>
				{headerAside}
			</div>
			<div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto">
				{sections.map((section) => (
					<div key={section.id} className="flex flex-col gap-0.5">
						{section.label && !collapsed ? (
							<p className="px-2 pb-1 text-xs text-meta">{section.label}</p>
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
			{footer ? <div className="flex flex-col gap-0.5">{footer}</div> : null}
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
				'group relative flex h-8 items-center gap-2.5 rounded-md px-2 text-[13px] transition-colors max-md:h-11',
				active ? 'bg-hover/60 text-fg' : 'text-muted hover:bg-hover/40 hover:text-fg',
				collapsed && 'justify-center px-0',
			)}
		>
			{active ? (
				<span
					className="absolute top-1.5 bottom-1.5 -left-3 w-0.5 rounded-r bg-accent"
					aria-hidden
				/>
			) : null}
			<Icon className="size-4 shrink-0" aria-hidden />
			{collapsed ? (
				<span className="sr-only">{item.label}</span>
			) : (
				<>
					<span className="flex-1 truncate">{item.label}</span>
					{item.count !== undefined ? (
						<span className="font-mono text-[11px] text-meta">{item.count}</span>
					) : null}
				</>
			)}
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
				'flex h-9 w-full items-center gap-2.5 rounded-md px-2 text-[13px] transition-colors max-md:h-11',
				emphasis
					? 'border border-border-strong bg-surface font-medium text-fg hover:bg-hover'
					: 'text-muted hover:bg-hover/40 hover:text-fg',
				collapsed && 'justify-center px-0',
			)}
		>
			<Icon className="size-4 shrink-0" aria-hidden />
			{collapsed ? (
				<span className="sr-only">{label}</span>
			) : (
				<>
					<span className="flex-1 text-left">{label}</span>
					{trailing}
				</>
			)}
		</button>
	);
	return collapsed ? <Tooltip content={label}>{button}</Tooltip> : button;
}
