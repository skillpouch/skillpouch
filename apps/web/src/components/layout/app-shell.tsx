// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The signed-in frame: optional sidebar (desktop column, mobile drawer),
 * top bar with search (⌘K), banners and the scrolling content area.
 *
 * The sidebar is a render prop so it can adapt to where it is shown
 * (collapsed column vs. drawer with a close button).
 */
import { X } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { Sheet, SheetClose, SheetContent } from '@/components/ui/sheet';
import { CommandPalette } from '@/features/search/command-palette';
import { cn } from '@/lib/cn';
import { TopBar, type TopBarProps } from './top-bar';

export interface SidebarRenderProps {
	collapsed: boolean;
	/** Closes the mobile drawer after navigation. */
	onNavigate?: () => void;
	headerAside?: ReactNode;
	toggleCollapsed?: () => void;
}

export interface AppShellProps {
	sidebar?: (props: SidebarRenderProps) => ReactNode;
	topBar?: Omit<TopBarProps, 'onOpenMenu' | 'onSearch'>;
	/** The open pouch, so search covers its items too. */
	pouchId?: string;
	banners?: ReactNode;
	children: ReactNode;
}

const COLLAPSE_KEY = 'skillpouch.sidebar.collapsed';

function useCollapsed(): [boolean, () => void] {
	const [collapsed, setCollapsed] = useState(() => localStorage.getItem(COLLAPSE_KEY) === '1');
	const toggle = () =>
		setCollapsed((value) => {
			localStorage.setItem(COLLAPSE_KEY, value ? '0' : '1');
			return !value;
		});
	useEffect(() => {
		const onKey = (event: KeyboardEvent) => {
			if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'b') {
				event.preventDefault();
				toggle();
			}
		};
		window.addEventListener('keydown', onKey);
		return () => window.removeEventListener('keydown', onKey);
	}, []);
	return [collapsed, toggle];
}

/** Every page shares one content width, so nothing shifts when you navigate. */
const CONTENT_WIDTH = 'max-w-[1200px]';

/** Only the content area scrolls; the top bar and sidebar stay put. */
export const CONTENT_SCROLL_ID = 'app-content';

export function AppShell({ sidebar, topBar, pouchId, banners, children }: AppShellProps) {
	const [collapsed, toggleCollapsed] = useCollapsed();
	const [drawerOpen, setDrawerOpen] = useState(false);
	const [searching, setSearching] = useState(false);
	return (
		<div className="flex h-dvh overflow-hidden">
			{sidebar ? (
				<aside
					className={cn(
						'hidden h-full shrink-0 overflow-hidden border-r border-border bg-bg transition-[width] duration-200 md:block',
						collapsed ? 'w-[53px]' : 'w-[240px]',
					)}
				>
					{sidebar({ collapsed, toggleCollapsed })}
				</aside>
			) : null}
			{sidebar ? (
				<Sheet open={drawerOpen} onOpenChange={setDrawerOpen}>
					<SheetContent side="left" title="Navigation" hideTitle>
						{sidebar({
							collapsed: false,
							onNavigate: () => setDrawerOpen(false),
							headerAside: (
								<SheetClose
									className="rounded-md p-2 text-muted hover:bg-hover hover:text-fg"
									aria-label="Close menu"
								>
									<X className="size-4" />
								</SheetClose>
							),
						})}
					</SheetContent>
				</Sheet>
			) : null}
			<div className="flex min-w-0 flex-1 flex-col">
				<TopBar
					{...topBar}
					onSearch={() => setSearching(true)}
					{...(sidebar ? { onOpenMenu: () => setDrawerOpen(true) } : {})}
				/>
				{banners}
				<main
					id={CONTENT_SCROLL_ID}
					data-scroll-restoration-id={CONTENT_SCROLL_ID}
					className="min-h-0 flex-1 overflow-y-auto px-4 py-6 [scrollbar-gutter:stable] sm:px-8 sm:py-8"
				>
					<div className={cn('mx-auto w-full', CONTENT_WIDTH)}>{children}</div>
				</main>
			</div>
			<CommandPalette pouchId={pouchId} open={searching} onOpenChange={setSearching} />
		</div>
	);
}
