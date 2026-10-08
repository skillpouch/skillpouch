// SPDX-License-Identifier: AGPL-3.0-only
/** One marketplace item before adding it: what it is, and every file it brings. */
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Download, ExternalLink, Plus, TriangleAlert } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { ErrorMessage } from '@/components/ui/error-message';
import { Skeleton } from '@/components/ui/skeleton';
import { CodeEditor } from '@/features/ingredients/components/code-editor';
import { FileTree, MobileFilePicker } from '@/features/ingredients/components/file-tree';
import { createDraft } from '@/features/ingredients/draft';
import { kindDefinition } from '@/features/ingredients/kinds';
import {
	base64Bytes,
	fetchMarketplaceItem,
	type Marketplace,
	type MarketplaceItem,
	type MarketplaceItemContent,
} from '../marketplaces';

const compact = new Intl.NumberFormat('en', { notation: 'compact' });

export function ItemPreview({
	marketplace,
	item,
	canAdd,
	busy,
	disabled,
	onAdd,
	onBack,
}: {
	marketplace: Marketplace;
	item: MarketplaceItem;
	canAdd: boolean;
	busy: boolean;
	disabled: boolean;
	onAdd: (content: MarketplaceItemContent) => void;
	onBack: () => void;
}) {
	const content = useQuery({
		queryKey: ['marketplaces', marketplace.id, 'item', item.key],
		queryFn: () => fetchMarketplaceItem(marketplace.id, item.key),
		staleTime: 5 * 60_000,
	});
	const definition = kindDefinition(item.kind);
	const Icon = definition?.icon;
	const description = content.data?.description ?? item.description;

	return (
		<div className="flex min-h-0 flex-col gap-5">
			<Button variant="link" size="sm" className="self-start text-muted" onClick={onBack}>
				<ArrowLeft /> {marketplace.name}
			</Button>

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
					{canAdd ? (
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
			{content.isPending ? <FilesPreviewSkeleton /> : null}
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

const FRAME =
	'flex h-[min(60dvh,520px)] min-h-0 flex-col overflow-hidden rounded-lg border border-border md:flex-row';

function FilesPreviewSkeleton() {
	return (
		<div className={FRAME} aria-label="Loading files" role="status">
			<div className="hidden w-56 shrink-0 flex-col gap-2.5 border-r border-border p-3 md:flex">
				{['w-3/5', 'w-2/5', 'w-4/5', 'w-1/2'].map((width) => (
					<Skeleton key={width} className={`h-3 ${width}`} />
				))}
			</div>
			<div className="flex flex-1 flex-col gap-2.5 p-4">
				{['w-2/5', 'w-11/12', 'w-3/4', 'w-5/6', 'w-3/5', 'w-4/5', 'w-1/3'].map((width) => (
					<Skeleton key={width} className={`h-3 ${width}`} />
				))}
			</div>
		</div>
	);
}

/** The item's files as the pouch editor shows them: folder tree, then the open file. */
function FilesPreview({
	name,
	files,
	truncated,
}: {
	name: string;
	files: MarketplaceItemContent['files'];
	truncated: boolean;
}) {
	const entries = useMemo(
		() =>
			createDraft(
				name,
				files.map((file) => ({ path: file.path, bytes: base64Bytes(file.content_b64) })),
			).entries,
		[name, files],
	);
	const [active, setActive] = useState<string | null>(null);
	const shown = entries.find((entry) => entry.path === active) ?? entries[0];

	return (
		<div className="flex flex-col gap-2">
			<div className={FRAME}>
				<aside className="hidden w-56 shrink-0 overflow-y-auto border-r border-border md:block">
					<FileTree
						entries={entries}
						active={shown?.path ?? null}
						editable={false}
						onOpen={setActive}
					/>
				</aside>
				<MobileFilePicker
					entries={entries}
					active={shown?.path ?? null}
					onOpen={setActive}
				/>
				<section className="flex min-h-0 min-w-0 flex-1 flex-col">
					<div className="flex h-9 shrink-0 items-center border-b border-border px-3 font-mono text-[13px] text-fg">
						<span className="truncate">{shown?.path ?? ''}</span>
					</div>
					<div className="min-h-0 flex-1">
						{!shown ? (
							<div className="flex h-full items-center justify-center text-[13px] text-meta">
								No files
							</div>
						) : shown.text === null ? (
							<div className="flex h-full items-center justify-center text-[13px] text-muted">
								Preview not available for this file type.
							</div>
						) : (
							<CodeEditor
								value={shown.text}
								path={shown.path}
								readOnly
								label={`Contents of ${shown.path}`}
							/>
						)}
					</div>
				</section>
			</div>
			{truncated ? (
				<p className="text-xs text-warn">Some files were too large to include.</p>
			) : null}
		</div>
	);
}
