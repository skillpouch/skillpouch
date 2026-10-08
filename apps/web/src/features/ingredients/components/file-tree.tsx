// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The files of an ingredient as a folder tree. In edit mode files can be
 * added, renamed and deleted; changed files carry a marker (new, modified,
 * deleted) like a source-control view.
 */
import { ChevronRight, File, FilePlus, Folder, Pencil, Trash2, Undo2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { cn } from '@/lib/cn';
import { fileStatus, type DraftEntry, type FileStatus } from '../draft';

interface TreeNode {
	name: string;
	path: string;
	entry?: DraftEntry;
	children: TreeNode[];
}

export function buildTree(entries: DraftEntry[]): TreeNode[] {
	const root: TreeNode = { name: '', path: '', children: [] };
	for (const entry of entries) {
		const parts = entry.path.split('/');
		let node = root;
		parts.forEach((part, index) => {
			const path = parts.slice(0, index + 1).join('/');
			const isFile = index === parts.length - 1;
			let child = node.children.find(
				(candidate) => candidate.name === part && !!candidate.entry === isFile,
			);
			if (!child) {
				child = { name: part, path, children: [], ...(isFile ? { entry } : {}) };
				node.children.push(child);
			}
			node = child;
		});
	}
	const sort = (nodes: TreeNode[]) => {
		nodes.sort((a, b) =>
			!!a.entry === !!b.entry ? a.name.localeCompare(b.name) : a.entry ? 1 : -1,
		);
		for (const node of nodes) sort(node.children);
	};
	sort(root.children);
	return root.children;
}

const MARKERS: Record<FileStatus, { label: string; className: string } | null> = {
	new: { label: 'N', className: 'text-success' },
	modified: { label: 'M', className: 'text-warn' },
	deleted: { label: 'D', className: 'text-danger' },
	unchanged: null,
};

export interface FileTreeProps {
	entries: DraftEntry[];
	active: string | null;
	editable: boolean;
	onOpen: (path: string) => void;
	onAdd?: () => void;
	onRename?: (path: string) => void;
	onDelete?: (path: string) => void;
	onRestore?: (path: string) => void;
}

export function FileTree(props: FileTreeProps) {
	const tree = useMemo(() => buildTree(props.entries), [props.entries]);
	return (
		<div className="flex h-full flex-col">
			<div className="flex h-9 items-center justify-between px-3 text-xs text-meta">
				<span>Files</span>
				{props.editable && props.onAdd ? (
					<button
						type="button"
						onClick={props.onAdd}
						className="rounded p-1 hover:bg-hover hover:text-fg"
						aria-label="New file"
					>
						<FilePlus className="size-3.5" />
					</button>
				) : null}
			</div>
			<ul
				role="tree"
				aria-label="Files"
				className="min-h-0 flex-1 overflow-y-auto px-1.5 pb-2"
			>
				{tree.map((node) => (
					<TreeItem key={node.path} node={node} depth={0} {...props} />
				))}
			</ul>
		</div>
	);
}

function TreeItem({ node, depth, ...props }: FileTreeProps & { node: TreeNode; depth: number }) {
	const [open, setOpen] = useState(true);
	const indent = { paddingLeft: 8 + depth * 12 };
	if (!node.entry) {
		return (
			<li role="treeitem" aria-expanded={open} aria-selected={false}>
				<button
					type="button"
					onClick={() => setOpen((value) => !value)}
					className="flex h-7 w-full items-center gap-1.5 rounded text-[13px] text-muted hover:bg-hover/50"
					style={indent}
				>
					<ChevronRight
						className={cn('size-3.5 transition-transform', open && 'rotate-90')}
					/>
					<Folder className="size-3.5" />
					{node.name}
				</button>
				{open ? (
					<ul role="group">
						{node.children.map((child) => (
							<TreeItem key={child.path} node={child} depth={depth + 1} {...props} />
						))}
					</ul>
				) : null}
			</li>
		);
	}
	const entry = node.entry;
	const status = fileStatus(entry);
	const marker = MARKERS[status];
	const selected = props.active === entry.path && !entry.deleted;
	return (
		<li role="treeitem" aria-selected={selected} className="group relative">
			<button
				type="button"
				disabled={entry.deleted}
				onClick={() => props.onOpen(entry.path)}
				className={cn(
					'flex h-7 w-full items-center gap-1.5 rounded pr-14 text-[13px] max-md:h-10',
					selected ? 'bg-hover text-fg' : 'text-muted hover:bg-hover/50 hover:text-fg',
					entry.deleted && 'line-through opacity-60',
				)}
				style={{ paddingLeft: indent.paddingLeft + 18 }}
			>
				<File className="size-3.5 shrink-0" />
				<span className="truncate">{node.name}</span>
				{marker ? (
					<span
						className={cn('ml-auto font-mono text-[11px]', marker.className)}
						aria-label={status}
					>
						{marker.label}
					</span>
				) : null}
			</button>
			{props.editable ? (
				<span className="absolute top-1/2 right-1 hidden -translate-y-1/2 gap-0.5 group-focus-within:flex group-hover:flex max-md:flex">
					{entry.deleted ? (
						<IconAction
							label={`Restore ${entry.path}`}
							onClick={() => props.onRestore?.(entry.path)}
						>
							<Undo2 />
						</IconAction>
					) : (
						<>
							<IconAction
								label={`Rename ${entry.path}`}
								onClick={() => props.onRename?.(entry.path)}
							>
								<Pencil />
							</IconAction>
							<IconAction
								label={`Delete ${entry.path}`}
								onClick={() => props.onDelete?.(entry.path)}
							>
								<Trash2 />
							</IconAction>
						</>
					)}
				</span>
			) : null}
		</li>
	);
}

function IconAction({
	label,
	onClick,
	children,
}: {
	label: string;
	onClick: () => void;
	children: React.ReactNode;
}) {
	return (
		<button
			type="button"
			aria-label={label}
			onClick={onClick}
			className="rounded p-1 text-meta hover:bg-hover hover:text-fg [&_svg]:size-3.5"
		>
			{children}
		</button>
	);
}

/** Small screens hide the tree; a file menu takes its place. */
export function MobileFilePicker({
	entries,
	active,
	onOpen,
}: {
	entries: DraftEntry[];
	active: string | null;
	onOpen: (path: string) => void;
}) {
	const live = entries.filter((entry) => !entry.deleted);
	if (live.length < 2) return null;
	return (
		<div className="border-b border-border p-2 md:hidden">
			<select
				aria-label="File"
				value={active ?? ''}
				onChange={(event) => onOpen(event.target.value)}
				className="h-10 w-full rounded-md border border-border-strong bg-surface px-2 font-mono text-[13px]"
			>
				{live.map((entry) => (
					<option key={entry.path} value={entry.path}>
						{entry.path}
					</option>
				))}
			</select>
		</div>
	);
}
