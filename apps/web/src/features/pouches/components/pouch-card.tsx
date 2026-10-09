// SPDX-License-Identifier: AGPL-3.0-only
/**
 * One pouch on the pouches grid: name, what's inside, which computers have it
 * and whether they're in sync. Locked pouches are dimmed with their actions;
 * deleted ones show their undo window.
 */
import { Link } from '@tanstack/react-router';
import { Lock } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { StatusDot } from '@/components/ui/status-dot';
import { activeDevices, deviceSyncState, useDevices } from '@/features/devices/devices';
import {
	countByKind,
	useOpenConflicts,
	usePouchContents,
} from '@/features/ingredients/ingredients';
import { KINDS } from '@/features/ingredients/kinds';
import { formatDate, formatTimeLeft, plural } from '@/lib/format';
import { useNow } from '@/lib/use-now';
import type { PouchView } from '../pouches';
import { PouchMonogram } from './pouch-monogram';

export interface PouchCardProps {
	pouch: PouchView;
	/** Shown when some pouches are locked, so the active one stands out. */
	showActiveBadge: boolean;
	onMakeActive: (pouch: PouchView) => void;
	onRestore: (pouch: PouchView) => void;
	onPurge: (pouch: PouchView) => void;
}

export function PouchCard({
	pouch,
	showActiveBadge,
	onMakeActive,
	onRestore,
	onPurge,
}: PouchCardProps) {
	if (pouch.state === 'deleted')
		return <DeletedPouchCard pouch={pouch} onRestore={onRestore} onPurge={onPurge} />;
	const locked = pouch.state === 'locked';
	return (
		<article
			className={
				'relative flex min-h-[168px] flex-col gap-4 rounded-lg border border-border bg-surface p-5 transition-colors hover:border-border-strong' +
				(locked ? ' opacity-70' : '')
			}
			aria-label={pouch.name}
		>
			<div className="flex items-start gap-3">
				{locked ? (
					<span className="inline-flex size-8 items-center justify-center rounded-md border border-border-strong">
						<Lock className="size-3.5 text-meta" aria-hidden />
					</span>
				) : (
					<PouchMonogram name={pouch.name} />
				)}
				<div className="min-w-0 flex-1">
					<div className="flex items-center gap-2">
						<Link
							to="/app/p/$pouchId"
							params={{ pouchId: pouch.id }}
							className="truncate text-sm font-medium text-fg after:absolute after:inset-0 after:content-['']"
						>
							{pouch.name}
						</Link>
						{!locked && showActiveBadge ? <Badge>Active</Badge> : null}
					</div>
					<p className="mt-0.5 line-clamp-2 text-[13px] text-muted">
						{locked
							? 'Locked — not synced on your current plan'
							: pouch.description || 'No description'}
					</p>
				</div>
			</div>
			<PouchSummary pouch={pouch} />
			{locked ? (
				<div className="relative z-10 flex gap-2">
					<Button size="sm" onClick={() => onMakeActive(pouch)}>
						Make active
					</Button>
					<Button size="sm" variant="ghost" asChild>
						<Link to="/app/p/$pouchId" params={{ pouchId: pouch.id }}>
							Open (read-only)
						</Link>
					</Button>
				</div>
			) : null}
		</article>
	);
}

function PouchSummary({ pouch }: { pouch: PouchView }) {
	const contents = usePouchContents(pouch.id);
	const conflicts = useOpenConflicts(pouch.id);
	const devices = useDevices();
	if (contents.isPending) return <Skeleton className="h-4 w-48" />;
	const counts = countByKind(contents.data?.ingredients ?? []);
	const parts = KINDS.filter((kind) => counts[kind.kind] > 0)
		.slice(0, 3)
		.map((kind) => plural(counts[kind.kind], kind.singular.toLowerCase()));
	const computers = activeDevices(devices.data).filter(
		(device) => deviceSyncState(device, pouch) !== 'never',
	);
	const behind = computers.filter((device) => deviceSyncState(device, pouch) === 'behind');
	return (
		<div className="mt-auto flex flex-col gap-3">
			<p className="font-mono text-xs text-muted">
				{parts.length ? parts.join(' · ') : 'Empty'}
			</p>
			{pouch.state === 'active' ? (
				<div className="flex items-center justify-between text-xs text-muted">
					<span>{plural(computers.length, 'computer')}</span>
					{conflicts.data?.length ? (
						<Link
							to="/app/p/$pouchId/conflicts"
							params={{ pouchId: pouch.id }}
							className="relative z-10 hover:underline"
						>
							<StatusDot
								tone="warn"
								label={plural(conflicts.data.length, 'conflict')}
							/>
						</Link>
					) : computers.length === 0 ? (
						<StatusDot tone="idle" label="Not on a computer yet" />
					) : behind.length > 0 ? (
						<StatusDot tone="busy" label={`${behind.length} syncing`} />
					) : (
						<StatusDot tone="ok" label="Synced" />
					)}
				</div>
			) : null}
		</div>
	);
}

function DeletedPouchCard({
	pouch,
	onRestore,
	onPurge,
}: {
	pouch: PouchView;
	onRestore: (pouch: PouchView) => void;
	onPurge: (pouch: PouchView) => void;
}) {
	const now = useNow(60_000);
	return (
		<article
			className="flex min-h-[168px] flex-col gap-3 rounded-lg border border-dashed border-border p-5"
			aria-label={`${pouch.name} (deleted)`}
		>
			<p className="text-sm font-medium text-muted line-through">{pouch.name}</p>
			{pouch.delete_after ? (
				<div className="flex flex-col gap-1 text-[13px]">
					<p className="text-fg">
						Deleted for good in{' '}
						<span className="tabular-nums">
							{formatTimeLeft(pouch.delete_after, now)}
						</span>
					</p>
					<p className="text-meta">
						On {formatDate(pouch.delete_after)}. Restore it until then.
					</p>
				</div>
			) : null}
			<div className="mt-auto flex flex-wrap gap-2">
				<Button size="sm" onClick={() => onRestore(pouch)}>
					Restore
				</Button>
				<Button size="sm" variant="danger-outline" onClick={() => onPurge(pouch)}>
					Delete permanently
				</Button>
			</div>
		</article>
	);
}
