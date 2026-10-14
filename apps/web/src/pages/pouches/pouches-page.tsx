// SPDX-License-Identifier: AGPL-3.0-only
/** `/pouches` — every pouch of the account, plus "New pouch". */
import { Link } from '@tanstack/react-router';
import { Plus } from 'lucide-react';
import { useState } from 'react';
import { AppShell } from '@/components/layout/app-shell';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { AccountBanners } from '@/features/account/account-banners';
import { activeDevices, useDevices } from '@/features/devices/devices';
import { MakeActiveDialog } from '@/features/pouches/components/make-active-dialog';
import { NewPouchDialog } from '@/features/pouches/components/new-pouch-dialog';
import { PouchCard } from '@/features/pouches/components/pouch-card';
import {
	usePouches,
	usePurgePouch,
	useRestorePouch,
	type PouchView,
} from '@/features/pouches/pouches';
import { useUnlocked } from '@/features/session/session-store';
import { toast } from '@/components/ui/toast';
import { describeError } from '@/lib/api/errors';
import { plural } from '@/lib/format';

export function PouchesPage() {
	const { me } = useUnlocked();
	const pouches = usePouches();
	const devices = useDevices();
	const restore = useRestorePouch();
	const purge = usePurgePouch();
	const [creating, setCreating] = useState(false);
	const [purging, setPurging] = useState<PouchView | null>(null);
	const [activating, setActivating] = useState<PouchView | null>(null);

	const all = pouches.data ?? [];
	const live = all.filter((pouch) => pouch.state !== 'deleted');
	const locked = live.filter((pouch) => pouch.state === 'locked');
	const limit = me.account.entitlements.pouch_limit;
	const atLimit = live.filter((pouch) => pouch.state === 'active').length >= limit;
	const computers = activeDevices(devices.data).length;
	const isFree = me.account.entitlements.plan_slug === 'free';

	const onRestore = (pouch: PouchView) =>
		restore.mutate(pouch.id, {
			onSuccess: () => toast.success(`“${pouch.name}” restored`),
			onError: (error) => toast.error(describeError(error)),
		});

	return (
		<AppShell topBar={{ showLogo: true }} banners={<AccountBanners />}>
			<PageHeader
				title="Pouches"
				description={`${plural(live.length, 'pouch', 'pouches')}, ${plural(computers, 'computer')} connected`}
			/>
			{locked.length > 0 ? (
				<div className="mb-4 flex flex-col gap-3 rounded-lg border border-border bg-surface px-4 py-3 text-[13px] sm:flex-row sm:items-center sm:justify-between">
					<p className="text-muted">
						You’re on {me.account.entitlements.plan_name}.{' '}
						{plural(locked.length, 'pouch is', 'pouches are')} locked.
						{isFree ? ' Upgrade to unlock them.' : ''}
					</p>
					{isFree ? (
						<Button variant="primary" size="sm" asChild>
							<Link to="/account/billing">Upgrade</Link>
						</Button>
					) : null}
				</div>
			) : null}
			<div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
				{pouches.isPending
					? Array.from({ length: 3 }, (_, index) => (
							<Skeleton key={index} className="h-[168px] rounded-lg" />
						))
					: all.map((pouch) => (
							<PouchCard
								key={pouch.id}
								pouch={pouch}
								showActiveBadge={locked.length > 0}
								onMakeActive={setActivating}
								onRestore={onRestore}
								onPurge={setPurging}
							/>
						))}
				{pouches.isPending ? null : atLimit ? (
					<div className="flex min-h-[168px] items-center justify-center rounded-lg border border-dashed border-border p-5 text-center text-[13px] text-muted">
						<p>
							{me.account.entitlements.plan_name} plan:{' '}
							{plural(limit, 'pouch', 'pouches')}
							{isFree ? (
								<>
									{' · '}
									<Link to="/account/billing" className="text-fg underline">
										Upgrade
									</Link>
								</>
							) : null}
						</p>
					</div>
				) : (
					<button
						type="button"
						onClick={() => setCreating(true)}
						className="flex min-h-[168px] flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border text-[13px] text-muted transition-colors hover:border-border-strong hover:text-fg"
					>
						<Plus className="size-5" aria-hidden />
						New pouch
					</button>
				)}
			</div>
			{pouches.error ? (
				<p className="mt-4 text-[13px] text-danger" role="alert">
					{describeError(pouches.error)}
				</p>
			) : null}
			<NewPouchDialog open={creating} onOpenChange={setCreating} />
			<ConfirmDialog
				open={purging !== null}
				onOpenChange={(open) => {
					if (!open) setPurging(null);
				}}
				title={`Delete “${purging?.name ?? ''}” permanently?`}
				description="Its items and their history are deleted now and can’t be restored."
				confirmLabel="Delete permanently"
				onConfirm={async () => {
					if (!purging) return;
					await purge.mutateAsync(purging.id);
					toast.success(`“${purging.name}” deleted permanently`);
				}}
			/>
			<MakeActiveDialog
				pouch={activating}
				pouches={live}
				pouchLimit={limit}
				onClose={() => setActivating(null)}
			/>
		</AppShell>
	);
}
