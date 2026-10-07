// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The signed-in frame: optional sidebar (desktop column, mobile drawer),
 * top bar, banners and the scrolling content area.
 *
 * The sidebar is a render prop so it can adapt to where it is shown
 * (collapsed column vs. drawer with a close button).
 */
import { X } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { Sheet, SheetClose, SheetContent } from '@/components/ui/sheet';
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
	topBar?: Omit<TopBarProps, 'onOpenMenu'>;
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

export function AppShell({ sidebar, topBar, banners, children }: AppShellProps) {
	const [collapsed, toggleCollapsed] = useCollapsed();
	const [drawerOpen, setDrawerOpen] = useState(false);
	return (
		<div className="flex min-h-dvh">
			{sidebar ? (
				<aside
					className={cn(
						'sticky top-0 hidden h-dvh shrink-0 border-r border-border bg-bg transition-[width] duration-200 md:block',
						collapsed ? 'w-[60px]' : 'w-[240px]',
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
					{...(sidebar ? { onOpenMenu: () => setDrawerOpen(true) } : {})}
				/>
				{banners}
				<main className="flex-1 px-4 py-6 sm:px-8 sm:py-8">
					<div className={cn('mx-auto w-full', CONTENT_WIDTH)}>{children}</div>
				</main>
			</div>
		</div>
	);
}
