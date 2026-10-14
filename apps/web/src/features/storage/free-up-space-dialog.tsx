// SPDX-License-Identifier: AGPL-3.0-only
/**
 * "Free up space": pick old versions & trash, individual items or whole
 * pouches until the account fits its plan again. Nothing is deleted before
 * the explicit "Delete permanently" confirmation.
 */
import { Link } from '@tanstack/react-router';
import { useQueries, useQueryClient } from '@tanstack/react-query';
import { ChevronDown, Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { ErrorMessage } from '@/components/ui/error-message';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import { Segmented } from '@/components/ui/segmented';
import { LoadingBlock } from '@/components/ui/spinner';
import { queryKeys } from '@/lib/api/query-keys';
import { cn } from '@/lib/cn';
import { formatBytes, formatRelative } from '@/lib/format';
import { loadPouchContents, type Ingredient } from '../ingredients/ingredients';
import { KINDS } from '../ingredients/kinds';
import { usePouches, type PouchView } from '../pouches/pouches';
import { useUnlocked } from '../session/session-store';
import { freeSpace, useStorage, type FreeSpaceProgress } from './storage';

interface Row {
	ingredient: Ingredient;
	pouch: PouchView;
	bytes: number;
	updatedAt: string;
}

type Sort = 'largest' | 'oldest';

export function FreeUpSpaceDialog({
	open,
	onOpenChange,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
}) {
	const { me, keyring } = useUnlocked();
	const client = useQueryClient();
	const storage = useStorage(open);
	const pouches = usePouches();
	const live = (pouches.data ?? []).filter(
		(pouch) => pouch.state !== 'deleted' && pouch.readable,
	);
	const contents = useQueries({
		queries: live.map((pouch) => ({
			queryKey: [...queryKeys.contents(pouch.id), keyring.roster.headSeq],
			queryFn: () => loadPouchContents(keyring, pouch.id),
			enabled: open,
		})),
	});

	const [sort, setSort] = useState<Sort>('largest');
	const [filter, setFilter] = useState('');
	const [history, setHistory] = useState(false);
	const [selected, setSelected] = useState<Set<string>>(new Set());
	const [wholePouches, setWholePouches] = useState<Set<string>>(new Set());
	const [confirming, setConfirming] = useState(false);
	const [progress, setProgress] = useState<FreeSpaceProgress | null>(null);
	const [error, setError] = useState<unknown>(null);

	const usage = storage.data;
	const sizes = useMemo(() => {
		const map = new Map<string, { bytes: number; updatedAt: string }>();
		for (const pouch of usage?.pouches ?? []) {
			for (const artifact of pouch.artifacts) {
				map.set(artifact.id, {
					bytes: artifact.head_bytes + artifact.history_bytes,
					updatedAt: artifact.updated_at,
				});
			}
		}
		return map;
	}, [usage]);

	const rows: Row[] = useMemo(() => {
		const result: Row[] = [];
		live.forEach((pouch, index) => {
			for (const ingredient of contents[index]?.data?.ingredients ?? []) {
				if (ingredient.deleted) continue;
				const size = sizes.get(ingredient.id);
				result.push({
					ingredient,
					pouch,
					bytes: size?.bytes ?? ingredient.size,
					updatedAt: size?.updatedAt ?? ingredient.updatedAt,
				});
			}
		});
		const needle = filter.trim().toLowerCase();
		return result
			.filter((row) => !needle || row.ingredient.name.toLowerCase().includes(needle))
			.sort((a, b) =>
				sort === 'largest' ? b.bytes - a.bytes : a.updatedAt.localeCompare(b.updatedAt),
			);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [contents, live.length, sizes, filter, sort]);

	const historyBytes = (usage?.pouches ?? []).reduce(
		(sum, pouch) =>
			sum +
			pouch.history_bytes +
			pouch.artifacts
				.filter((artifact) => artifact.deleted)
				.reduce((s, a) => s + a.head_bytes, 0),
		0,
	);
	const pouchBytes = (id: string) => usage?.pouches.find((pouch) => pouch.id === id)?.bytes ?? 0;
	const selectedBytes =
		(history ? historyBytes : 0) +
		[...wholePouches].reduce((sum, id) => sum + pouchBytes(id), 0) +
		rows
			.filter((row) => selected.has(row.ingredient.id) && !wholePouches.has(row.pouch.id))
			.reduce((sum, row) => sum + row.bytes, 0);
	const used = usage?.used_bytes ?? me.account.used_bytes;
	const quota = usage?.quota_bytes ?? me.account.quota_bytes;
	const needed = Math.max(0, used - quota - selectedBytes);
	const nothingSelected = !history && selected.size === 0 && wholePouches.size === 0;
	const loading = storage.isPending || contents.some((query) => query.isPending);

	const reset = () => {
		setHistory(false);
		setSelected(new Set());
		setWholePouches(new Set());
		setConfirming(false);
		setProgress(null);
		setError(null);
	};

	const toggleItem = (id: string) =>
		setSelected((current) => {
			const next = new Set(current);
			if (next.has(id)) next.delete(id);
			else next.add(id);
			return next;
		});
	const togglePouch = (id: string) =>
		setWholePouches((current) => {
			const next = new Set(current);
			if (next.has(id)) next.delete(id);
			else next.add(id);
			return next;
		});

	const run = async () => {
		setError(null);
		setProgress({ done: 0, total: 1 });
		try {
			await freeSpace(
				{
					historyOf: history ? live.map((pouch) => pouch.id) : [],
					pouches: [...wholePouches],
					items: live.map((pouch) => ({
						pouch,
						ingredients: rows
							.filter(
								(row) =>
									row.pouch.id === pouch.id && selected.has(row.ingredient.id),
							)
							.map((row) => row.ingredient),
					})),
				},
				setProgress,
			);
			await Promise.all([
				client.invalidateQueries({ queryKey: queryKeys.storage }),
				client.invalidateQueries({ queryKey: queryKeys.me }),
				client.invalidateQueries({ queryKey: queryKeys.pouches }),
				client.invalidateQueries({ queryKey: ['pouch'] }),
			]);
			reset();
			onOpenChange(false);
		} catch (caught) {
			setError(caught);
			setProgress(null);
			setConfirming(false);
			await client.invalidateQueries({ queryKey: queryKeys.storage });
		}
	};

	const busy = progress !== null;

	return (
		<Dialog
			open={open}
			onOpenChange={(next) => {
				if (!next) reset();
				onOpenChange(next);
			}}
		>
			<DialogContent
				size="lg"
				title="Free up space"
				description={`${me.account.entitlements.plan_name} includes ${formatBytes(quota)}. Nothing is deleted until you confirm.`}
				busy={busy}
				footer={
					confirming ? (
						<>
							<p className="mr-auto text-[13px] text-muted">
								Deleted items are removed from every synced computer the next time
								it syncs.
							</p>
							<Button disabled={busy} onClick={() => setConfirming(false)}>
								Back
							</Button>
							<Button variant="danger" loading={busy} onClick={() => void run()}>
								{busy && progress
									? `Deleting… ${progress.done}/${progress.total}`
									: `Delete ${formatBytes(selectedBytes)}`}
							</Button>
						</>
					) : (
						<>
							<p className="mr-auto flex items-center gap-3 text-[13px] text-muted">
								{nothingSelected
									? 'Nothing selected'
									: `${formatBytes(selectedBytes)} selected`}
								{me.account.entitlements.plan_slug === 'free' ? (
									<Link
										to="/account/billing"
										className="text-fg underline underline-offset-4"
										onClick={() => onOpenChange(false)}
									>
										Upgrade instead
									</Link>
								) : null}
							</p>
							<Button onClick={() => onOpenChange(false)}>Cancel</Button>
							<Button
								variant="danger"
								disabled={nothingSelected}
								onClick={() => setConfirming(true)}
							>
								Delete permanently
							</Button>
						</>
					)
				}
			>
				<div className="flex flex-col gap-4">
					<div className="flex flex-col gap-2">
						<Progress
							value={used - selectedBytes}
							max={quota}
							label="Storage after deleting the selection"
							marker={used > quota ? quota / used : undefined}
						/>
						<div className="flex justify-between text-xs">
							<span className="text-muted">
								{formatBytes(used)} of {formatBytes(quota)}
							</span>
							{needed > 0 ? (
								<span className="text-warn">
									Select at least {formatBytes(needed)} more
								</span>
							) : used > quota ? (
								<span className="text-success">Enough selected</span>
							) : null}
						</div>
					</div>
					<ErrorMessage error={error} />
					{loading ? (
						<LoadingBlock label="Loading your pouches" />
					) : (
						<>
							<div className="flex flex-col gap-2 sm:flex-row">
								<div className="relative flex-1">
									<Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-meta" />
									<Input
										value={filter}
										onChange={(event) => setFilter(event.target.value)}
										placeholder="Filter items…"
										aria-label="Filter items"
										className="pl-8"
									/>
								</div>
								<Segmented
									label="Sort"
									value={sort}
									onChange={setSort}
									options={[
										{ value: 'largest', label: 'Largest first' },
										{ value: 'oldest', label: 'Oldest first' },
									]}
								/>
							</div>
							<label className="flex cursor-pointer items-center gap-3 rounded-lg border border-border p-3">
								<Checkbox
									checked={history}
									onCheckedChange={(value) => setHistory(value === true)}
									disabled={historyBytes === 0}
								/>
								<span className="flex flex-1 flex-col">
									<span className="text-[13px] font-medium">
										Old versions & trash
									</span>
									<span className="text-xs text-muted">
										Removes previous versions (kept for 30 days) and the trash
										(kept for 7 days).
									</span>
								</span>
								<span className="font-mono text-xs">
									{formatBytes(historyBytes)}
								</span>
							</label>
							{live.map((pouch) => (
								<PouchGroup
									key={pouch.id}
									pouch={pouch}
									bytes={pouchBytes(pouch.id)}
									rows={rows.filter((row) => row.pouch.id === pouch.id)}
									selected={selected}
									wholeSelected={wholePouches.has(pouch.id)}
									onToggleItem={toggleItem}
									onTogglePouch={() => togglePouch(pouch.id)}
								/>
							))}
						</>
					)}
				</div>
			</DialogContent>
		</Dialog>
	);
}

function PouchGroup({
	pouch,
	bytes,
	rows,
	selected,
	wholeSelected,
	onToggleItem,
	onTogglePouch,
}: {
	pouch: PouchView;
	bytes: number;
	rows: Row[];
	selected: Set<string>;
	wholeSelected: boolean;
	onToggleItem: (id: string) => void;
	onTogglePouch: () => void;
}) {
	const [open, setOpen] = useState(true);
	return (
		<section className="border-t border-border pt-3" aria-label={pouch.name}>
			<div className="flex items-center gap-3">
				<Checkbox
					checked={wholeSelected}
					onCheckedChange={onTogglePouch}
					aria-label={`Delete the whole “${pouch.name}” pouch now`}
				/>
				<button
					type="button"
					onClick={() => setOpen((value) => !value)}
					className="flex flex-1 items-center gap-1.5 text-left text-[13px] font-medium"
					aria-expanded={open}
				>
					<ChevronDown
						className={cn(
							'size-4 text-meta transition-transform',
							!open && '-rotate-90',
						)}
					/>
					{pouch.name}
					{pouch.state === 'locked' ? (
						<span className="text-xs font-normal text-meta">Locked</span>
					) : null}
				</button>
				<span className="text-xs text-meta">Select whole pouch</span>
				<span className="w-16 text-right font-mono text-xs">{formatBytes(bytes)}</span>
			</div>
			{open ? (
				<div className="mt-2 flex flex-col">
					{KINDS.map((kind) => {
						const items = rows.filter((row) => row.ingredient.kind === kind.kind);
						if (items.length === 0) return null;
						const Icon = kind.icon;
						return (
							<div key={kind.kind} className="flex flex-col">
								<p className="py-1.5 pl-7 text-xs text-meta">
									{kind.label} ·{' '}
									{formatBytes(items.reduce((sum, row) => sum + row.bytes, 0))}
								</p>
								{items.map((row) => (
									<label
										key={row.ingredient.id}
										className="flex min-h-9 cursor-pointer items-center gap-3 rounded-md px-0 text-[13px] hover:bg-hover/40 max-sm:min-h-11"
									>
										<Checkbox
											checked={
												wholeSelected || selected.has(row.ingredient.id)
											}
											disabled={wholeSelected}
											onCheckedChange={() => onToggleItem(row.ingredient.id)}
										/>
										<Icon className="size-4 text-meta" aria-hidden />
										<span className="flex-1 truncate font-mono">
											{row.ingredient.name}
										</span>
										<span className="hidden text-xs text-meta sm:inline">
											Updated {formatRelative(row.updatedAt)}
										</span>
										<span className="w-16 text-right font-mono text-xs">
											{formatBytes(row.bytes)}
										</span>
									</label>
								))}
							</div>
						);
					})}
					{rows.length === 0 ? (
						<p className="py-2 pl-7 text-xs text-meta">No items</p>
					) : null}
				</div>
			) : null}
		</section>
	);
}
