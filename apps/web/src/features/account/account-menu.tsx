// SPDX-License-Identifier: AGPL-3.0-only
/** Avatar button with the account menu: account pages and sign out. */
import { useNavigate } from '@tanstack/react-router';
import { CreditCard, LogOut, MonitorSmartphone, Shield, User } from 'lucide-react';
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { signOut } from '@/features/session/bootstrap';
import { getSession, useSession } from '@/features/session/session-store';
import { Avatar } from './avatar';

export function AccountMenu() {
	const session = useSession();
	const navigate = useNavigate();
	if (!('me' in session)) return null;
	const { user } = session.me;
	const go = (to: string) => void navigate({ to });
	return (
		<DropdownMenu>
			<DropdownMenuTrigger
				className="rounded-full focus-visible:outline-offset-2"
				aria-label="Account menu"
			>
				<Avatar name={user.name || user.email} image={user.image} />
			</DropdownMenuTrigger>
			<DropdownMenuContent className="w-60">
				<DropdownMenuLabel className="flex flex-col">
					<span className="truncate text-[13px] text-fg">{user.name}</span>
					<span className="truncate">{user.email}</span>
				</DropdownMenuLabel>
				<DropdownMenuSeparator />
				<DropdownMenuItem onSelect={() => go('/app/account')}>
					<User /> Account
				</DropdownMenuItem>
				<DropdownMenuItem onSelect={() => go('/app/account/devices')}>
					<MonitorSmartphone /> Devices
				</DropdownMenuItem>
				<DropdownMenuItem onSelect={() => go('/app/account/security')}>
					<Shield /> Security
				</DropdownMenuItem>
				<DropdownMenuItem onSelect={() => go('/app/account/billing')}>
					<CreditCard /> Billing
				</DropdownMenuItem>
				<DropdownMenuSeparator />
				<DropdownMenuItem
					onSelect={async () => {
						await signOut(getSession());
						await navigate({ to: '/sign-in' });
					}}
				>
					<LogOut /> Sign out
				</DropdownMenuItem>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
