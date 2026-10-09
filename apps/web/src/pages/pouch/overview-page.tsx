// SPDX-License-Identifier: AGPL-3.0-only
/** `/app/p/:pouchId` — a short summary of the pouch and the account. */
import { PageSkeleton } from '@/components/ui/page-skeleton';
import { Link, useParams } from '@tanstack/react-router';
import { TriangleAlert } from 'lucide-react';
import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/layout/page-header';
import { Skeleton } from '@/components/ui/skeleton';
import { PlanCard } from '@/features/billing/plan-card';
import { activeDevices, deviceSyncState, useDevices } from '@/features/devices/devices';
import {
	countByKind,
	inScope,
	useOpenConflicts,
	usePouchContents,
} from '@/features/ingredients/ingredients';
import { KINDS, kindDefinition } from '@/features/ingredients/kinds';
import { usePouch } from '@/features/pouches/pouches';
import { formatRelative, plural } from '@/lib/format';

export function OverviewPage() {
	const { pouchId } = useParams({ strict: false }) as { pouchId: string };
	const pouch = usePouch(pouchId).data;
	const contents = usePouchContents(pouchId);
	const conflicts = useOpenConflicts(pouchId);
	const devices = useDevices();
	if (!pouch) return <PageSkeleton variant="overview" />;

	const ingredients = inScope(contents.data?.ingredients ?? []);
	const counts = countByKind(ingredients);
	const computers = activeDevices(devices.data).filter(
		(device) => deviceSyncState(device, pouch) !== 'never',
	);
	const synced = computers.filter((device) => deviceSyncState(device, pouch) === 'synced');
	const lastSeen = computers
		.filter((device) => device.last_seen_at)
		.sort((a, b) => b.last_seen_at!.localeCompare(a.last_seen_at!))[0];
	const recent = [...ingredients]
		.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
		.slice(0, 5);
	const openConflicts = conflicts.data ?? [];

	return (
		<div className="flex flex-col gap-6">
			<PageHeader
				title={pouch.name}
				description={pouch.description || 'Overview'}
				className="mb-0"
			/>
			<PlanCard />
			<section
				className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-4"
				aria-label="Summary"
			>
				<Stat label="Computers">
					<Link to="/app/account/devices" className="hover:underline">
						{computers.length === 0
							? 'None yet'
							: `${synced.length} of ${computers.length} synced`}
					</Link>
				</Stat>
				<Stat label="Last sync">
					{lastSeen ? `${formatRelative(lastSeen.last_seen_at)} · ${lastSeen.name}` : '—'}
				</Stat>
				<Stat label="Last added">
					{recent[0] ? formatRelative(recent[0].updatedAt) : '—'}
				</Stat>
				<Stat label="Ingredients">
					{contents.isPending ? <Skeleton className="h-4 w-8" /> : ingredients.length}
				</Stat>
			</section>
			<p className="flex flex-wrap gap-x-3 gap-y-1 text-[13px] text-muted">
				{KINDS.map((kind) => (
					<Link
						key={kind.kind}
						to="/app/p/$pouchId/$kind"
						params={{ pouchId, kind: kind.slug }}
						className="hover:text-fg"
					>
						<span className="font-mono text-fg">{counts[kind.kind]}</span>{' '}
						{kind.label.toLowerCase()}
					</Link>
				))}
			</p>
			{openConflicts.length > 0 ? (
				<section
					className="rounded-lg border border-warn/30 bg-warn-tint p-4"
					aria-label="Needs attention"
				>
					<p className="flex items-center gap-2 text-[13px] font-medium">
						<TriangleAlert className="size-4 text-warn" aria-hidden />
						Needs attention
					</p>
					<p className="mt-1 text-[13px] text-muted">
						{plural(openConflicts.length, 'item was', 'items were')} changed in two
						places at once. Both versions are kept until you pick one.
					</p>
					<Button className="mt-3" size="sm" variant="outline" asChild>
						<Link to="/app/p/$pouchId/conflicts" params={{ pouchId }}>
							Resolve conflicts
						</Link>
					</Button>
				</section>
			) : null}
			<section aria-label="Recently added">
				<h2 className="mb-3 text-sm font-medium">Recently added</h2>
				{recent.length === 0 ? (
					<p className="text-[13px] text-muted">
						Nothing here yet. Add something, or connect a computer and it syncs what you
						already have.
					</p>
				) : (
					<ul className="divide-y divide-border-soft rounded-lg border border-border">
						{recent.map((item) => {
							const kind = kindDefinition(item.kind)!;
							const Icon = kind.icon;
							return (
								<li key={item.id}>
									<Link
										to="/app/p/$pouchId/$kind"
										params={{ pouchId, kind: kind.slug }}
										search={{ item: item.id }}
										className="flex items-center gap-3 px-4 py-3 text-[13px] hover:bg-surface"
									>
										<Icon className="size-4 text-meta" aria-hidden />
										<span className="flex-1 truncate font-mono">
											{item.name}
										</span>
										<span className="text-xs text-meta">{kind.singular}</span>
										<span className="w-24 text-right text-xs text-meta">
											{formatRelative(item.updatedAt)}
										</span>
									</Link>
								</li>
							);
						})}
					</ul>
				)}
			</section>
		</div>
	);
}

function Stat({ label, children }: { label: string; children: ReactNode }) {
	return (
		<div className="flex flex-col gap-1 bg-bg p-4">
			<span className="text-xs text-meta">{label}</span>
			<span className="truncate text-[13px] text-fg">{children}</span>
		</div>
	);
}
