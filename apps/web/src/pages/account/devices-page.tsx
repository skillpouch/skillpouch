// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `/app/account/devices` — every computer and browser that can open the
 * pouches. Revoking signs it out immediately and rotates the pouch keys.
 */
import { useQuery } from '@tanstack/react-query';
import { ChevronRight, TerminalSquare } from 'lucide-react';
import { useState } from 'react';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { ErrorMessage } from '@/components/ui/error-message';
import { PromptDialog } from '@/components/ui/prompt-dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from '@/components/ui/toast';
import { ConnectCliDialog } from '@/features/devices/components/connect-cli-dialog';
import { BrowserRow, ComputerRow } from '@/features/devices/components/device-rows';
import {
	useDevices,
	useRenameDevice,
	useRevokeBrowser,
	useRevokeDevice,
} from '@/features/devices/devices';
import { usePouches } from '@/features/pouches/pouches';
import { bootstrapSession } from '@/features/session/bootstrap';
import { api } from '@/lib/api/client';
import { queryKeys } from '@/lib/api/query-keys';
import type { BrowserRecord, DeviceRecord, SecuritySettingsRecord } from '@/lib/api/types';
import { cn } from '@/lib/cn';

export function DevicesPage() {
	const devices = useDevices();
	const pouches = usePouches();
	const settings = useQuery({
		queryKey: queryKeys.securitySettings,
		queryFn: () => api.get<SecuritySettingsRecord>('/v1/account/security-settings'),
	});
	const rename = useRenameDevice();
	const revokeDevice = useRevokeDevice();
	const revokeBrowser = useRevokeBrowser();
	const [connecting, setConnecting] = useState(false);
	const [renaming, setRenaming] = useState<DeviceRecord | null>(null);
	const [revokingDevice, setRevokingDevice] = useState<DeviceRecord | null>(null);
	const [revokingBrowser, setRevokingBrowser] = useState<BrowserRecord | null>(null);
	const [showRevoked, setShowRevoked] = useState(false);

	const computers = devices.data?.devices ?? [];
	const browsers = devices.data?.browsers ?? [];
	const activeComputers = computers.filter((device) => device.state !== 'revoked');
	const activeBrowsers = browsers.filter(
		(browser) => !browser.revoked_at && browser.removed_seq === null,
	);
	const revoked = [
		...computers.filter((device) => device.state === 'revoked'),
		...browsers.filter((browser) => browser.revoked_at || browser.removed_seq !== null),
	];
	const trustDays = settings.data?.browser_trust_days ?? 30;

	return (
		<>
			<PageHeader
				title="Devices"
				description="Computers and browsers that can open your pouches."
				actions={
					<Button variant="primary" onClick={() => setConnecting(true)}>
						<TerminalSquare /> Connect CLI
					</Button>
				}
			/>
			<ErrorMessage error={devices.error} />
			<section aria-label="Computers" className="mb-8">
				<h2 className="mb-3 text-sm font-medium">Computers</h2>
				{devices.isPending ? (
					<Skeleton className="h-20" />
				) : activeComputers.length === 0 ? (
					<EmptyState
						icon={TerminalSquare}
						title="No computers yet"
						description="Connect a computer to sync your pouches to every AI assistant on it."
						action={<Button onClick={() => setConnecting(true)}>Connect CLI</Button>}
					/>
				) : (
					<ul className="divide-y divide-border-soft rounded-lg border border-border">
						{activeComputers.map((device) => (
							<ComputerRow
								key={device.id}
								device={device}
								pouches={pouches.data ?? []}
								onRename={setRenaming}
								onRevoke={setRevokingDevice}
							/>
						))}
					</ul>
				)}
			</section>
			<section aria-label="Browsers" className="mb-8">
				<h2 className="mb-3 text-sm font-medium">Browsers</h2>
				{devices.isPending ? (
					<Skeleton className="h-16" />
				) : (
					<ul className="divide-y divide-border-soft rounded-lg border border-border">
						{activeBrowsers.map((browser) => (
							<BrowserRow
								key={browser.member_id}
								browser={browser}
								trustDays={trustDays}
								onRevoke={setRevokingBrowser}
							/>
						))}
					</ul>
				)}
			</section>
			{revoked.length > 0 ? (
				<section aria-label="Revoked">
					<button
						type="button"
						onClick={() => setShowRevoked((value) => !value)}
						className="mb-3 flex items-center gap-1 text-sm text-muted hover:text-fg"
						aria-expanded={showRevoked}
					>
						<ChevronRight
							className={cn(
								'size-4 transition-transform',
								showRevoked && 'rotate-90',
							)}
						/>
						Revoked ({revoked.length})
					</button>
					{showRevoked ? (
						<ul className="divide-y divide-border-soft rounded-lg border border-border opacity-70">
							{revoked.map((entry) =>
								'id' in entry ? (
									<ComputerRow
										key={entry.id}
										device={entry}
										pouches={[]}
										onRename={() => undefined}
										onRevoke={() => undefined}
									/>
								) : (
									<BrowserRow
										key={entry.member_id}
										browser={entry}
										trustDays={trustDays}
										onRevoke={() => undefined}
									/>
								),
							)}
						</ul>
					) : null}
				</section>
			) : null}

			<ConnectCliDialog open={connecting} onOpenChange={setConnecting} />
			<PromptDialog
				open={renaming !== null}
				onOpenChange={(open) => !open && setRenaming(null)}
				title="Rename device"
				description="The name is only a label here. It doesn’t change anything on the computer."
				label="Device name"
				initialValue={renaming?.name ?? ''}
				submitLabel="Save"
				validate={(value) =>
					!value
						? 'Give the device a name.'
						: value.length > 64
							? 'Use at most 64 characters.'
							: null
				}
				onSubmit={(name) => {
					if (!renaming) return;
					rename.mutate(
						{ id: renaming.id, name },
						{ onError: (error) => toast.error((error as Error).message) },
					);
				}}
			/>
			<ConfirmDialog
				open={revokingDevice !== null}
				onOpenChange={(open) => !open && setRevokingDevice(null)}
				title={`Revoke ${revokingDevice?.name ?? 'device'}?`}
				description="Revoking signs it out immediately. Every pouch gets new keys, so it can’t read anything changed from now on. Files already on that computer stay there."
				confirmLabel="Revoke device"
				onConfirm={async () => {
					if (revokingDevice) await revokeDevice.mutateAsync(revokingDevice);
					toast.success('Device revoked');
				}}
			/>
			<ConfirmDialog
				open={revokingBrowser !== null}
				onOpenChange={(open) => !open && setRevokingBrowser(null)}
				title={
					revokingBrowser?.is_current ? 'Remove this browser?' : 'Revoke this browser?'
				}
				description={
					revokingBrowser?.is_current
						? 'You’ll be signed out here. Unlock again with your master password next time.'
						: 'It is signed out immediately and every pouch gets new keys.'
				}
				confirmLabel={revokingBrowser?.is_current ? 'Remove' : 'Revoke'}
				onConfirm={async () => {
					if (!revokingBrowser) return;
					await revokeBrowser.mutateAsync(revokingBrowser.member_id);
					if (revokingBrowser.is_current) await bootstrapSession();
					else toast.success('Browser revoked');
				}}
			/>
		</>
	);
}
