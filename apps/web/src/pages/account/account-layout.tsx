// SPDX-License-Identifier: AGPL-3.0-only
/** The frame of the account pages: Profile, Devices, Usage, Security, Billing. */
import { Outlet } from '@tanstack/react-router';
import {
	Activity,
	CreditCard,
	MonitorSmartphone,
	PanelLeft,
	Shield,
	TerminalSquare,
	User,
} from 'lucide-react';
import { useState } from 'react';
import { AppShell } from '@/components/layout/app-shell';
import { Sidebar, SidebarButton } from '@/components/layout/sidebar';
import { Shortcut } from '@/components/ui/kbd';
import { AccountBanners } from '@/features/account/account-banners';
import { ConnectCliDialog } from '@/features/devices/components/connect-cli-dialog';

const SECTIONS = [
	{
		id: 'account',
		label: 'Account',
		items: [
			{ to: '/app/account', label: 'Profile', icon: User, exact: true },
			{ to: '/app/account/devices', label: 'Devices', icon: MonitorSmartphone },
			{ to: '/app/account/usage', label: 'Usage', icon: Activity },
			{ to: '/app/account/security', label: 'Security', icon: Shield },
			{ to: '/app/account/billing', label: 'Billing', icon: CreditCard },
		],
	},
];

export function AccountLayout() {
	const [connecting, setConnecting] = useState(false);
	return (
		<AppShell
			topBar={{ leading: <span className="text-[13px] font-medium">Account</span> }}
			banners={<AccountBanners />}
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
		</AppShell>
	);
}
