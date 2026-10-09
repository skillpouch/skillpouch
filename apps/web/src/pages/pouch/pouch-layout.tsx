// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The frame of everything inside one pouch: ingredient navigation with
 * counts, the pouch switcher, ⌘K search, "Connect CLI", and the notices for
 * locked or deleted pouches.
 */
import { Link, Outlet, useParams } from '@tanstack/react-router';
import {
	GitMerge,
	LayoutGrid,
	PanelLeft,
	Settings,
	Share2,
	Store,
	TerminalSquare,
} from 'lucide-react';
import { useState } from 'react';
import { AppShell } from '@/components/layout/app-shell';
import { Banner } from '@/components/layout/banner';
import { Sidebar, SidebarButton, SidebarLink } from '@/components/layout/sidebar';
import { Button } from '@/components/ui/button';
import { Shortcut } from '@/components/ui/kbd';
import { PageSkeleton } from '@/components/ui/page-skeleton';
import { AccountBanners } from '@/features/account/account-banners';
import { ConnectCliDialog } from '@/features/devices/components/connect-cli-dialog';
import {
	countByKind,
	useOpenConflicts,
	usePouchContents,
} from '@/features/ingredients/ingredients';
import { KINDS } from '@/features/ingredients/kinds';
import { PouchSwitcher } from '@/features/pouches/components/pouch-switcher';
import { usePouch, useRestorePouch } from '@/features/pouches/pouches';
import { formatDate } from '@/lib/format';
import { NotFoundPage } from '../not-found-page';

export function PouchLayout() {
	const { pouchId } = useParams({ strict: false }) as { pouchId: string };
	const pouch = usePouch(pouchId);
	const contents = usePouchContents(pouchId);
	const conflicts = useOpenConflicts(pouchId);
	const restore = useRestorePouch();
	const [connecting, setConnecting] = useState(false);

	// While the pouch list loads, the frame is already drawn and the page shows a skeleton.
	if (!pouch.isPending && !pouch.data) return <NotFoundPage />;
	const state = pouch.data?.state;

	const counts = countByKind(contents.data?.ingredients ?? []);
	const params = { pouchId };
	const sections = [
		{
			id: 'overview',
			items: [
				{ to: '/app/p/$pouchId', params, label: 'Overview', icon: LayoutGrid, exact: true },
				{
					to: '/app/p/$pouchId/marketplaces',
					params,
					label: 'Marketplaces',
					icon: Store,
				},
				// Only while something waits to be resolved.
				...(conflicts.data?.length
					? [
							{
								to: '/app/p/$pouchId/conflicts',
								params,
								label: 'Conflicts',
								icon: GitMerge,
								count: conflicts.data.length,
							},
						]
					: []),
			],
		},
		{
			id: 'ingredients',
			items: KINDS.map((kind) => ({
				to: '/app/p/$pouchId/$kind',
				params: { pouchId, kind: kind.slug },
				label: kind.label,
				icon: kind.icon,
				...(contents.data && !kind.single ? { count: counts[kind.kind] } : {}),
			})),
		},
	];

	return (
		<AppShell
			topBar={{ leading: <PouchSwitcher pouchId={pouchId} /> }}
			pouchId={pouchId}
			banners={
				<>
					<AccountBanners />
					{state === 'locked' ? (
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
					{state === 'deleted' && pouch.data ? (
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
									trailing={<Shortcut keys={['mod', 'B']} />}
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
			{pouch.data ? <Outlet /> : <PageSkeleton variant="overview" />}
			<ConnectCliDialog open={connecting} onOpenChange={setConnecting} />
		</AppShell>
	);
}
