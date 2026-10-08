// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A kind a pouch holds only one of (instructions): its main file is shown
 * right on the page instead of a list.
 */
import { Pencil, Plus, Share2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { ErrorMessage } from '@/components/ui/error-message';
import { Skeleton } from '@/components/ui/skeleton';
import { formatRelative } from '@/lib/format';
import { asText, languageOf } from '../content';
import { useIngredientFiles, type Ingredient } from '../ingredients';
import type { KindDefinition } from '../kinds';
import { CodeEditor } from './code-editor';

export function SingleIngredient({
	pouchId,
	kind,
	item,
	loading,
	readOnly,
	onCreate,
	onEdit,
	onShare,
}: {
	pouchId: string;
	kind: KindDefinition;
	item: Ingredient | null;
	loading: boolean;
	readOnly: boolean;
	onCreate: () => void;
	onEdit: (item: Ingredient) => void;
	onShare: (item: Ingredient) => void;
}) {
	const files = useIngredientFiles(pouchId, item);

	if (!loading && !item) {
		return (
			<EmptyState
				icon={kind.icon}
				title={`No ${kind.label.toLowerCase()} yet`}
				description={kind.blurb}
				action={
					readOnly ? null : (
						<Button onClick={onCreate}>
							<Plus /> Write {kind.label.toLowerCase()}
						</Button>
					)
				}
			/>
		);
	}

	const bytes = files.data?.get(kind.mainFile);
	const text = bytes ? asText(bytes) : null;

	return (
		<section
			aria-label={kind.label}
			className="flex flex-col overflow-hidden rounded-lg border border-border"
		>
			<header className="flex items-center gap-3 border-b border-border px-4 py-2.5">
				<div className="min-w-0 flex-1">
					<p className="truncate font-mono text-[13px] text-fg">{kind.mainFile}</p>
					{item ? (
						<p className="truncate text-xs text-meta">
							Updated {formatRelative(item.updatedAt)}
						</p>
					) : (
						<Skeleton className="mt-1 h-3 w-24" />
					)}
				</div>
				{item && !readOnly ? (
					<div className="flex shrink-0 items-center gap-1.5">
						<Button size="sm" onClick={() => onEdit(item)}>
							<Pencil /> Edit
						</Button>
						<Button size="sm" variant="ghost" onClick={() => onShare(item)}>
							<Share2 /> <span className="max-sm:sr-only">Share</span>
						</Button>
					</div>
				) : null}
			</header>
			<div className="h-[min(60vh,560px)]">
				{files.error ? (
					<ErrorMessage error={files.error} className="p-4" />
				) : text !== null ? (
					<CodeEditor
						value={text}
						language={languageOf(kind.mainFile)}
						readOnly
						label={`Contents of ${kind.mainFile}`}
					/>
				) : (
					<div className="flex flex-col gap-2.5 p-4">
						<Skeleton className="h-4 w-40" />
						<Skeleton className="h-3 w-3/4" />
						<Skeleton className="h-3 w-2/3" />
						<Skeleton className="h-3 w-1/2" />
					</div>
				)}
			</div>
		</section>
	);
}
