// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The frame of everything inside one pouch: ingredient navigation with
 * counts, the pouch switcher, ⌘K search, "Connect CLI", and the notices for
 * locked or deleted pouches.
 */
import { Link, Outlet, useParams } from '@tanstack/react-router';
import { LayoutGrid, PanelLeft, Settings, Share2, TerminalSquare } from 'lucide-react';
import { useState } from 'react';
import { AppShell } from '@/components/layout/app-shell';
import { Banner } from '@/components/layout/banner';
import { Sidebar, SidebarButton, SidebarLink } from '@/components/layout/sidebar';
import { Button } from '@/components/ui/button';
import { Kbd } from '@/components/ui/kbd';
import { LoadingBlock } from '@/components/ui/spinner';
import { AccountBanners } from '@/features/account/account-banners';
import { ConnectCliDialog } from '@/features/devices/components/connect-cli-dialog';
import { countByKind, usePouchContents } from '@/features/ingredients/ingredients';
import { KINDS } from '@/features/ingredients/kinds';
import { PouchSwitcher } from '@/features/pouches/components/pouch-switcher';
import { usePouch, useRestorePouch } from '@/features/pouches/pouches';
import { CommandPalette } from '@/features/search/command-palette';
import { formatDate } from '@/lib/format';
import { modKey } from '@/lib/platform';
import { NotFoundPage } from '../not-found-page';

export function PouchLayout() {
	const { pouchId } = useParams({ strict: false }) as { pouchId: string };
	const pouch = usePouch(pouchId);
	const contents = usePouchContents(pouchId);
	const restore = useRestorePouch();
	const [connecting, setConnecting] = useState(false);
	const [searching, setSearching] = useState(false);

	if (pouch.isPending) return <LoadingBlock />;
	if (!pouch.data) return <NotFoundPage />;

	const counts = countByKind(contents.data?.ingredients ?? []);
	const params = { pouchId };
	const sections = [
		{
			id: 'overview',
			items: [
				{ to: '/app/p/$pouchId', params, label: 'Overview', icon: LayoutGrid, exact: true },
			],
		},
		{
			id: 'ingredients',
			items: KINDS.map((kind) => ({
				to: '/app/p/$pouchId/$kind',
				params: { pouchId, kind: kind.slug },
				label: kind.label,
				icon: kind.icon,
				...(contents.data ? { count: counts[kind.kind] } : {}),
			})),
		},
	];

	return (
		<AppShell
			topBar={{
				leading: <PouchSwitcher pouchId={pouchId} />,
				onSearch: () => setSearching(true),
			}}
			banners={
				<>
					<AccountBanners />
					{pouch.data.state === 'locked' ? (
						<Banner
							tone="locked"
							action={
								<Button size="sm" asChild>
									<Link to="/app">Manage pouches</Link>
								</Button>
							}
						>
							This pouch is locked on your current plan: read-only here and not synced
							to your computers. You can still delete items to free up space.
						</Banner>
					) : null}
					{pouch.data.state === 'deleted' ? (
						<Banner
							tone="warn"
							action={
								<Button
									size="sm"
									loading={restore.isPending}
									onClick={() => restore.mutate(pouchId)}
								>
									Restore
								</Button>
							}
						>
							This pouch is deleted and will be removed for good on{' '}
							{formatDate(pouch.data.delete_after)}.
						</Banner>
					) : null}
				</>
			}
			sidebar={({ collapsed, onNavigate, headerAside, toggleCollapsed }) => (
				<Sidebar
					sections={sections}
					collapsed={collapsed}
					{...(onNavigate ? { onNavigate } : {})}
					headerAside={headerAside}
					footer={
						<>
							<SidebarLink
								item={{
									to: '/app/p/$pouchId/shared',
									params,
									label: 'Shared links',
									icon: Share2,
								}}
								collapsed={collapsed}
								onNavigate={onNavigate}
							/>
							<SidebarLink
								item={{
									to: '/app/p/$pouchId/settings',
									params,
									label: 'Pouch settings',
									icon: Settings,
								}}
								collapsed={collapsed}
								onNavigate={onNavigate}
							/>
							{toggleCollapsed ? (
								<SidebarButton
									icon={PanelLeft}
									label={collapsed ? 'Expand' : 'Collapse'}
									onClick={toggleCollapsed}
									collapsed={collapsed}
									trailing={<Kbd>{modKey()}B</Kbd>}
								/>
							) : null}
							<div className="mt-2">
								<SidebarButton
									icon={TerminalSquare}
									label="Connect CLI"
									onClick={() => {
										onNavigate?.();
										setConnecting(true);
									}}
									collapsed={collapsed}
									emphasis
								/>
							</div>
						</>
					}
				/>
			)}
		>
			<Outlet />
			<ConnectCliDialog open={connecting} onOpenChange={setConnecting} />
			<CommandPalette pouchId={pouchId} open={searching} onOpenChange={setSearching} />
		</AppShell>
	);
}
