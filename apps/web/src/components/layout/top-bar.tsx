// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The top bar. One component for every signed-in page; areas are switched on
 * by props: the menu button only when there is a sidebar, the logo only when
 * there isn't, search when the frame provides it.
 */
import { Link } from '@tanstack/react-router';
import { Menu, Search } from 'lucide-react';
import type { ReactNode } from 'react';
import { Logo } from '@/components/brand/logo';
import { Shortcut } from '@/components/ui/kbd';
import { AccountMenu } from '@/features/account/account-menu';
import { PlanPill } from '@/features/billing/plan-badge';

export interface TopBarProps {
	/** Opens the mobile drawer; the button is hidden when omitted. */
	onOpenMenu?: () => void;
	/** Shows the logo (pages without a sidebar). */
	showLogo?: boolean;
	/** Left content after the logo/menu (pouch switcher, page title). */
	leading?: ReactNode;
	/** Opens the command palette; the search field is hidden when omitted. */
	onSearch?: () => void;
}

export function TopBar({ onOpenMenu, showLogo = false, leading, onSearch }: TopBarProps) {
	return (
		<header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b border-border bg-bg/90 px-3 backdrop-blur sm:px-6">
			{onOpenMenu ? (
				<button
					type="button"
					onClick={onOpenMenu}
					aria-label="Open menu"
					className="-ml-1 rounded-md p-2 text-muted hover:bg-hover hover:text-fg md:hidden"
				>
					<Menu className="size-5" />
				</button>
			) : null}
			{showLogo ? (
				<Link to="/app" aria-label="All pouches" className="mr-2">
					<Logo />
				</Link>
			) : onOpenMenu ? (
				<Link to="/app" aria-label="All pouches" className="md:hidden">
					<Logo withWordmark={false} />
				</Link>
			) : null}
			<div className="flex min-w-0 flex-1 items-center gap-2">{leading}</div>
			{onSearch ? (
				<>
					<button
						type="button"
						onClick={onSearch}
						className="hidden h-8 w-64 items-center gap-2 rounded-md border border-border bg-surface px-2.5 text-[13px] text-meta hover:border-border-strong sm:flex"
					>
						<Search className="size-4" aria-hidden />
						<span className="flex-1 text-left">Search…</span>
						<Shortcut keys={['mod', 'K']} />
					</button>
					<button
						type="button"
						onClick={onSearch}
						aria-label="Search"
						className="rounded-md p-2 text-muted hover:bg-hover hover:text-fg sm:hidden"
					>
						<Search className="size-5" />
					</button>
				</>
			) : null}
			<PlanPill />
			<AccountMenu />
		</header>
	);
}
