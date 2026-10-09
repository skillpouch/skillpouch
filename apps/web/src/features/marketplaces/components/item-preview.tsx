// SPDX-License-Identifier: AGPL-3.0-only
/** One marketplace item before adding it: what it is, and every file it brings. */
import { useQuery } from '@tanstack/react-query';
import { Download, ExternalLink, Plus, TriangleAlert } from 'lucide-react';
import { useMemo } from 'react';
import { BackButton } from '@/components/ui/back-button';
import { Button } from '@/components/ui/button';
import { ErrorMessage } from '@/components/ui/error-message';
import { FilesView, FilesViewSkeleton } from '@/features/ingredients/components/files-view';
import type { Ingredient } from '@/features/ingredients/ingredients';
import { kindDefinition } from '@/features/ingredients/kinds';
import { base64Bytes, type MarketplaceItem, type MarketplaceItemContent } from '../marketplaces';
import { InstalledMark } from './item-grid';

const compact = new Intl.NumberFormat('en', { notation: 'compact' });

export function ItemPreview({
	source,
	item,
	canAdd,
	installed,
	busy,
	disabled,
	onAdd,
	onRemove,
	onBack,
}: {
	/** Where the item comes from: names the back button and loads its files. */
	source: { id: string; name: string; load: (key: string) => Promise<MarketplaceItemContent> };
	item: MarketplaceItem;
	canAdd: boolean;
	/** The pouch already has this item. */
	installed: Ingredient | undefined;
	busy: boolean;
	disabled: boolean;
	onAdd: (content: MarketplaceItemContent) => void;
	onRemove: (ingredient: Ingredient) => void;
	onBack?: () => void;
}) {
	const content = useQuery({
		queryKey: ['marketplaces', source.id, 'item', item.key],
		queryFn: () => source.load(item.key),
		staleTime: 5 * 60_000,
	});
	const definition = kindDefinition(item.kind);
	const Icon = definition?.icon;
	const description = content.data?.description ?? item.description;

	return (
		<div className="flex min-h-0 flex-col gap-5">
			{onBack ? (
				<BackButton onClick={onBack} className="-my-2 bg-bg py-2">
					{source.name}
				</BackButton>
			) : null}

			<div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
				<div className="flex min-w-0 items-start gap-3">
					<span
						aria-hidden
						className="flex size-10 shrink-0 items-center justify-center rounded-md border border-border bg-surface text-muted [&_svg]:size-5"
					>
						{Icon ? <Icon /> : null}
					</span>
					<div className="flex min-w-0 flex-col gap-1">
						<h2 className="truncate text-lg font-semibold tracking-tight">
							{item.name}
						</h2>
						<p className="flex flex-wrap items-center gap-x-2 text-xs text-meta">
							{definition ? <span>{definition.singular}</span> : null}
							{item.repo ? <span>· {item.repo}</span> : null}
							{item.installs ? (
								<span className="flex items-center gap-1">
									· <Download className="size-3" aria-hidden />
									{compact.format(item.installs)} installs
								</span>
							) : null}
						</p>
						{description ? (
							<p className="mt-1 max-w-2xl text-[13px] text-muted">{description}</p>
						) : null}
					</div>
				</div>
				<div className="flex shrink-0 items-center gap-2">
					{content.data ? (
						<Button variant="ghost" size="sm" asChild>
							<a href={content.data.url} target="_blank" rel="noreferrer">
								Source <ExternalLink />
							</a>
						</Button>
					) : null}
					{installed ? <InstalledMark className="px-1" /> : null}
					{canAdd && installed ? (
						<Button
							variant="outline"
							loading={busy}
							disabled={disabled}
							onClick={() => onRemove(installed)}
						>
							Remove
						</Button>
					) : null}
					{canAdd && !installed ? (
						<Button
							variant="primary"
							disabled={!content.data || disabled}
							loading={busy}
							onClick={() => content.data && onAdd(content.data)}
						>
							<Plus /> Add to pouch
						</Button>
					) : null}
				</div>
			</div>

			{definition?.runsCommands ? (
				<p className="flex items-start gap-2 rounded-md border border-warn/30 bg-warn-tint px-3 py-2 text-[13px] text-warn">
					<TriangleAlert className="mt-0.5 size-4 shrink-0" />
					This runs a command on every computer synced with this pouch. Check it before
					adding.
				</p>
			) : null}

			{content.error ? <ErrorMessage error={content.error} /> : null}
			{content.isPending ? <FilesViewSkeleton /> : null}
			{content.data ? (
				<FilesPreview
					name={content.data.name}
					files={content.data.files}
					truncated={content.data.truncated}
				/>
			) : null}
		</div>
	);
}

function FilesPreview({
	name,
	files,
	truncated,
}: {
	name: string;
	files: MarketplaceItemContent['files'];
	truncated: boolean;
}) {
	const decoded = useMemo(
		() => files.map((file) => ({ path: file.path, bytes: base64Bytes(file.content_b64) })),
		[files],
	);
	return (
		<div className="flex flex-col gap-2">
			<FilesView name={name} files={decoded} />
			{truncated ? (
				<p className="text-xs text-warn">Some files were too large to include.</p>
			) : null}
		</div>
	);
}
