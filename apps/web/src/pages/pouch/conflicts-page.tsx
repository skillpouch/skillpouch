// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `/app/p/:pouchId/conflicts`: items changed in two places at once, each
 * with both versions side by side and a button to keep one. The CLI sends
 * people here (`skillpouch conflicts`, `c` in the TUI).
 */
import { useParams } from '@tanstack/react-router';
import { Check, Trash2 } from 'lucide-react';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { ErrorMessage } from '@/components/ui/error-message';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from '@/components/ui/toast';
import {
	latestPerItem,
	useConflictVersions,
	useResolveConflict,
	type ConflictVersion,
	type Keep,
} from '@/features/conflicts/conflicts';
import { useDevices } from '@/features/devices/devices';
import { FilesView, FilesViewSkeleton } from '@/features/ingredients/components/files-view';
import { useOpenConflicts, type ConflictRecord } from '@/features/ingredients/ingredients';
import { kindDefinition } from '@/features/ingredients/kinds';
import { usePouch, type PouchView } from '@/features/pouches/pouches';
import { describeError } from '@/lib/api/errors';
import { formatRelative, plural } from '@/lib/format';

export function ConflictsPage() {
	const { pouchId } = useParams({ strict: false }) as { pouchId: string };
	const pouch = usePouch(pouchId).data;
	const conflicts = useOpenConflicts(pouchId);
	const open = latestPerItem(conflicts.data ?? []);

	return (
		<div className="flex flex-col gap-6">
			<PageHeader
				title="Conflicts"
				description={
					conflicts.isPending
						? 'Items changed in two places at once'
						: open.length === 0
							? 'Nothing changed in two places at once'
							: `${plural(open.length, 'item was', 'items were')} changed in two places at once. Pick the version to keep; every computer gets it.`
				}
				className="mb-0"
			/>
			{conflicts.error ? <ErrorMessage error={conflicts.error} /> : null}
			{conflicts.isPending || !pouch ? (
				<Skeleton className="h-[480px] rounded-lg" />
			) : open.length === 0 ? (
				<EmptyState
					icon={Check}
					title="No conflicts"
					description="When an item is changed on two computers before they sync, both versions show up here."
				/>
			) : (
				open.map((conflict) => (
					<ConflictCard key={conflict.id} pouch={pouch} conflict={conflict} />
				))
			)}
		</div>
	);
}

function ConflictCard({ pouch, conflict }: { pouch: PouchView; conflict: ConflictRecord }) {
	const versions = useConflictVersions(pouch.id, conflict);
	const resolve = useResolveConflict(pouch);
	const devices = useDevices();
	const from =
		devices.data?.devices.find((device) => device.id === conflict.device_id)?.name ??
		'another computer';
	const head = versions.data?.head;
	const sameName = conflict.type === 'name_collision';
	const kind = head ? kindDefinition(head.kind) : undefined;
	const Icon = kind?.icon;

	const keep = (choice: Keep) =>
		versions.data &&
		resolve.mutate(
			{ conflict, versions: versions.data, keep: choice },
			{
				onSuccess: () => toast.success(`Kept ${head?.name ?? 'the item'}`),
				onError: (error) => toast.error(describeError(error)),
			},
		);

	return (
		<section
			className="flex flex-col gap-4 rounded-lg border border-warn/30 p-4 sm:p-5"
			aria-label={head ? `Conflict: ${head.name}` : 'Conflict'}
		>
			<header className="flex items-start gap-3">
				<span
					aria-hidden
					className="flex size-9 shrink-0 items-center justify-center rounded-md border border-border bg-surface text-muted [&_svg]:size-4"
				>
					{Icon ? <Icon /> : null}
				</span>
				<div className="min-w-0">
					<h2 className="truncate text-sm font-medium">
						{head ? head.name : <Skeleton className="h-4 w-32" />}
					</h2>
					<p className="text-xs text-meta">
						{kind ? `${kind.singular} · ` : ''}
						{sameName ? 'made with a name already taken' : 'changed'} on {from}{' '}
						{formatRelative(conflict.created_at)}
					</p>
				</div>
			</header>
			{versions.error ? <ErrorMessage error={versions.error} /> : null}
			<div className="grid gap-4 xl:grid-cols-2">
				<Side
					title="In the pouch"
					hint={sameName ? 'The item that has this name' : 'What every computer has now'}
					version={versions.data?.pouch}
					loading={versions.isPending}
					busy={resolve.isPending}
					onKeep={() => keep('pouch')}
				/>
				<Side
					title={`From ${from}`}
					hint={
						sameName
							? 'A new item with the same name; keeping it replaces the other'
							: 'Changed there at the same time'
					}
					version={versions.data?.incoming}
					loading={versions.isPending}
					busy={resolve.isPending}
					onKeep={() => keep('incoming')}
				/>
			</div>
		</section>
	);
}

function Side({
	title,
	hint,
	version,
	loading,
	busy,
	onKeep,
}: {
	title: string;
	hint: string;
	version: ConflictVersion | null | undefined;
	loading: boolean;
	busy: boolean;
	onKeep: () => void;
}) {
	const deleted = version?.revision.deleted === true;
	return (
		<div className="flex min-w-0 flex-col gap-3">
			<div className="flex items-center justify-between gap-3">
				<div className="min-w-0">
					<h3 className="text-[13px] font-medium">{title}</h3>
					<p className="text-xs text-meta">{hint}</p>
				</div>
				<Button
					size="sm"
					variant="outline"
					disabled={loading || !version}
					loading={busy}
					onClick={onKeep}
				>
					{deleted ? 'Keep it deleted' : 'Keep this version'}
				</Button>
			</div>
			{loading ? (
				<FilesViewSkeleton className="h-[min(50dvh,420px)]" />
			) : !version ? (
				<p className="text-[13px] text-muted">This version isn't available.</p>
			) : deleted ? (
				<div className="flex h-[min(50dvh,420px)] flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border text-[13px] text-muted">
					<Trash2 className="size-5" aria-hidden />
					Deleted here
				</div>
			) : (
				<FilesView
					name={version.revision.name}
					files={version.files}
					className="h-[min(50dvh,420px)]"
				/>
			)}
		</div>
	);
}
