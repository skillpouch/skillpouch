// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The frame of `/admin`. Only for admins: anyone else gets the ordinary
 * "not found" page, so the dashboard doesn't announce itself. The server
 * checks the role (and a recent sign-in for changes) on every request
 * regardless; this gate only keeps the pages tidy.
 */
import { Outlet, useNavigate } from '@tanstack/react-router';
import {
	ArrowLeft,
	BarChart3,
	CreditCard,
	Layers,
	LayoutDashboard,
	PanelLeft,
	Receipt,
	ScrollText,
	Server,
	Users,
} from 'lucide-react';
import { useEffect } from 'react';
import { AppShell } from '@/components/layout/app-shell';
import { Sidebar, SidebarButton } from '@/components/layout/sidebar';
import { Badge } from '@/components/ui/badge';
import { Shortcut } from '@/components/ui/kbd';
import { isAdmin } from '@/features/admin/admin';
import { useSession } from '@/features/session/session-store';
import { NotFoundPage } from '@/pages/not-found-page';

const SECTIONS = [
	{
		id: 'dashboard',
		label: 'Dashboard',
		items: [
			{ to: '/admin', label: 'Overview', icon: LayoutDashboard, exact: true },
			{ to: '/admin/analytics', label: 'Analytics', icon: BarChart3 },
		],
	},
	{
		id: 'manage',
		label: 'Manage',
		items: [
			{ to: '/admin/users', label: 'Users', icon: Users },
			{ to: '/admin/subscriptions', label: 'Subscriptions', icon: CreditCard },
			{ to: '/admin/payments', label: 'Payments', icon: Receipt },
			{ to: '/admin/plans', label: 'Plans', icon: Layers },
		],
	},
	{
		id: 'security',
		label: 'Security',
		items: [
			{ to: '/admin/audit', label: 'Audit log', icon: ScrollText },
			{ to: '/admin/system', label: 'System', icon: Server },
		],
	},
];

export function AdminLayout() {
	const session = useSession();
	const navigate = useNavigate();
	const allowed = 'me' in session && isAdmin(session.me);
	useNoIndex();
	if (!allowed) return <NotFoundPage />;
	return (
		<AppShell
			topBar={{
				leading: (
					<span className="flex items-center gap-2 text-[13px] font-medium">
						Admin <Badge tone="accent">restricted</Badge>
					</span>
				),
			}}
			sidebar={({ collapsed, onNavigate, headerAside, toggleCollapsed }) => (
				<Sidebar
					sections={SECTIONS}
					collapsed={collapsed}
					{...(onNavigate ? { onNavigate } : {})}
					headerAside={headerAside}
					footer={
						<>
							{toggleCollapsed ? (
								<SidebarButton
									icon={PanelLeft}
									label={collapsed ? 'Expand' : 'Collapse'}
									onClick={toggleCollapsed}
									collapsed={collapsed}
									trailing={<Shortcut keys={['mod', 'B']} />}
								/>
							) : null}
							<SidebarButton
								icon={ArrowLeft}
								label="Back to SkillPouch"
								onClick={() => {
									onNavigate?.();
									void navigate({ to: '/app' });
								}}
								collapsed={collapsed}
							/>
						</>
					}
				/>
			)}
		>
			<Outlet />
		</AppShell>
	);
}

/** Search engines never list admin pages, even if a link leaks. */
function useNoIndex() {
	useEffect(() => {
		const meta = document.createElement('meta');
		meta.name = 'robots';
		meta.content = 'noindex, nofollow';
		document.head.append(meta);
		return () => meta.remove();
	}, []);
}
