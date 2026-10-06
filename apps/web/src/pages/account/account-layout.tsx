// SPDX-License-Identifier: AGPL-3.0-only
/** The frame of the account pages: Profile, Devices, Security, Billing. */
import { Outlet } from '@tanstack/react-router';
import { CreditCard, MonitorSmartphone, Shield, User } from 'lucide-react';
import { AppShell } from '@/components/layout/app-shell';
import { Sidebar } from '@/components/layout/sidebar';
import { AccountBanners } from '@/features/account/account-banners';

const SECTIONS = [
	{
		id: 'account',
		label: 'Account',
		items: [
			{ to: '/app/account', label: 'Profile', icon: User, exact: true },
			{ to: '/app/account/devices', label: 'Devices', icon: MonitorSmartphone },
			{ to: '/app/account/security', label: 'Security', icon: Shield },
			{ to: '/app/account/billing', label: 'Billing', icon: CreditCard },
		],
	},
];

export function AccountLayout() {
	return (
		<AppShell
			width="narrow"
			topBar={{ leading: <span className="text-[13px] font-medium">Account</span> }}
			banners={<AccountBanners />}
			sidebar={({ collapsed, onNavigate, headerAside }) => (
				<Sidebar
					sections={SECTIONS}
					collapsed={collapsed}
					{...(onNavigate ? { onNavigate } : {})}
					headerAside={headerAside}
				/>
			)}
		>
			<Outlet />
		</AppShell>
	);
}
