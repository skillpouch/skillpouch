// SPDX-License-Identifier: AGPL-3.0-only
/** Rows of the Devices page: computers (CLIs) and browsers. */
import { Ellipsis, Globe, Laptop, Monitor, Pencil, Trash2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { StatusDot } from '@/components/ui/status-dot';
import type { BrowserRecord, DeviceRecord, PouchRecord } from '@/lib/api/types';
import { formatDate, formatRelative } from '@/lib/format';
import { browserLabel } from '@/lib/platform';
import { deviceSyncState, OS_LABEL } from '../devices';
import { AssistantBadge } from './assistant-badge';

const OS_ICON = { linux: Monitor, macos: Laptop, windows: Monitor } as const;

export function ComputerRow({
	device,
	pouches,
	onRename,
	onRevoke,
}: {
	device: DeviceRecord;
	pouches: Pick<PouchRecord, 'id' | 'event_seq' | 'state'>[];
	onRename: (device: DeviceRecord) => void;
	onRevoke: (device: DeviceRecord) => void;
}) {
	const Icon = OS_ICON[device.os];
	const tracked = pouches.filter(
		(pouch) => pouch.state === 'active' && deviceSyncState(device, pouch) !== 'never',
	);
	const behind = tracked.filter((pouch) => deviceSyncState(device, pouch) === 'behind').length;
	const revoked = device.state === 'revoked';
	return (
		<li className="flex items-start gap-3 p-4" aria-label={device.name}>
			<Icon className="mt-0.5 size-5 shrink-0 text-muted" aria-hidden />
			<div className="min-w-0 flex-1">
				<p className="flex flex-wrap items-center gap-2 text-[13px]">
					<span className="font-medium text-fg">{device.name}</span>
					<span className="text-meta">
						{OS_LABEL[device.os]} · {device.arch} · v{device.cli_version}
					</span>
				</p>
				{device.assistants.length > 0 ? (
					<p className="mt-1.5 flex flex-wrap gap-1.5">
						{device.assistants.map((assistant) => (
							<AssistantBadge key={assistant} id={assistant} />
						))}
					</p>
				) : null}
				<p className="mt-1.5 text-xs text-meta">
					{revoked
						? `Revoked ${formatDate(device.revoked_at)}`
						: `Last seen ${formatRelative(device.last_seen_at)} · added ${formatDate(device.created_at)}`}
				</p>
			</div>
			{revoked ? null : (
				<div className="flex items-center gap-2">
					{device.state === 'suspended' ? (
						<StatusDot tone="warn" label="Suspended" />
					) : tracked.length === 0 ? (
						<StatusDot tone="idle" label="No pouches yet" />
					) : behind > 0 ? (
						<StatusDot tone="busy" label="Syncing" />
					) : (
						<StatusDot tone="ok" label="Synced" />
					)}
					<DropdownMenu>
						<DropdownMenuTrigger
							aria-label={`Actions for ${device.name}`}
							className="rounded-md p-1.5 text-muted hover:bg-hover hover:text-fg"
						>
							<Ellipsis className="size-4" />
						</DropdownMenuTrigger>
						<DropdownMenuContent>
							<DropdownMenuItem onSelect={() => onRename(device)}>
								<Pencil /> Rename
							</DropdownMenuItem>
							<DropdownMenuItem tone="danger" onSelect={() => onRevoke(device)}>
								<Trash2 /> Revoke
							</DropdownMenuItem>
						</DropdownMenuContent>
					</DropdownMenu>
				</div>
			)}
		</li>
	);
}

export function BrowserRow({
	browser,
	trustDays,
	onRevoke,
}: {
	browser: BrowserRecord;
	trustDays: number;
	onRevoke: (browser: BrowserRecord) => void;
}) {
	const revoked = browser.revoked_at !== null || browser.removed_seq !== null;
	const trustedUntil = browser.last_seen_at
		? new Date(new Date(browser.last_seen_at).getTime() + trustDays * 86_400_000)
		: null;
	return (
		<li
			className="flex items-start gap-3 p-4"
			aria-label={browser.is_current ? 'This browser' : 'Browser'}
		>
			<Globe className="mt-0.5 size-5 shrink-0 text-muted" aria-hidden />
			<div className="min-w-0 flex-1">
				<p className="flex items-center gap-2 text-[13px]">
					<span className="font-medium">
						{browser.is_current ? browserLabel() : 'Browser'}
					</span>
					{browser.is_current ? <Badge tone="accent">This browser</Badge> : null}
				</p>
				<p className="mt-1.5 text-xs text-meta">
					{revoked
						? `Revoked ${formatDate(browser.revoked_at)}`
						: `Last used ${formatRelative(browser.last_seen_at)}${trustedUntil ? ` · trusted until ${formatDate(trustedUntil)} unless used again` : ''}`}
				</p>
			</div>
			{revoked ? null : (
				<button
					type="button"
					onClick={() => onRevoke(browser)}
					className="rounded-md px-2 py-1 text-[13px] text-danger hover:bg-danger-tint"
				>
					{browser.is_current ? 'Remove' : 'Revoke'}
				</button>
			)}
		</li>
	);
}
