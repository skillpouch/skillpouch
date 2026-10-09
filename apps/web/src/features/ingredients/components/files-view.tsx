// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Read-only view of an item's files: the file tree on the left (a picker on
 * phones), the selected file on the right with syntax highlighting.
 */
import { useMemo, useState } from 'react';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/cn';
import { createDraft } from '../draft';
import { CodeEditor } from './code-editor';
import { FileTree, MobileFilePicker } from './file-tree';

const FRAME =
	'flex h-[min(60dvh,520px)] min-h-0 flex-col overflow-hidden rounded-lg border border-border md:flex-row';

export function FilesView({
	name,
	files,
	className,
}: {
	name: string;
	files: { path: string; bytes: Uint8Array }[];
	className?: string;
}) {
	const entries = useMemo(() => createDraft(name, files).entries, [name, files]);
	const [active, setActive] = useState<string | null>(null);
	const shown = entries.find((entry) => entry.path === active) ?? entries[0];

	return (
		<div className={cn(FRAME, className)}>
			<aside className="hidden w-56 shrink-0 overflow-y-auto border-r border-border md:block">
				<FileTree
					entries={entries}
					active={shown?.path ?? null}
					editable={false}
					onOpen={setActive}
				/>
			</aside>
			<MobileFilePicker entries={entries} active={shown?.path ?? null} onOpen={setActive} />
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
	);
}

export function FilesViewSkeleton({ className }: { className?: string }) {
	return (
		<div className={cn(FRAME, className)} aria-label="Loading files" role="status">
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
