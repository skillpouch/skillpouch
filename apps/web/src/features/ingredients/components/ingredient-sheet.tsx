// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The ingredient panel, in three modes:
 *   show    — read-only files with metadata, Edit / Share / Delete
 *   edit    — multi-file editor; only "Save changes" writes (one signed revision)
 *   create  — same editor for a new ingredient, starting from the kind's template
 */
import { Pencil, Share2, Trash2, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { ErrorMessage } from '@/components/ui/error-message';
import { Input } from '@/components/ui/input';
import { PromptDialog } from '@/components/ui/prompt-dialog';
import { Sheet, SheetContent } from '@/components/ui/sheet';
import { LoadingBlock } from '@/components/ui/spinner';
import { cn } from '@/lib/cn';
import { formatBytes, formatRelative, plural } from '@/lib/format';
import type { PouchView } from '../../pouches/pouches';
import { LANGUAGE_LABEL, languageOf } from '../content';
import {
	changedCount,
	createDraft,
	draftFiles,
	draftReducer,
	fileStatus,
	isDirty,
	renameFromTemplate,
	TEMPLATE_PLACEHOLDER,
	type Draft,
	type DraftAction,
} from '../draft';
import { useIngredientFiles, type Ingredient } from '../ingredients';
import { NAME_MAX, validateName, validatePath, type KindDefinition } from '../kinds';
import { useCreateIngredient, useUpdateIngredient } from '../mutations';
import { CodeEditor } from './code-editor';
import { FileTree } from './file-tree';

export type SheetMode = 'show' | 'edit' | 'create';

export interface IngredientSheetProps {
	pouch: PouchView;
	kind: KindDefinition;
	ingredient: Ingredient | null;
	mode: SheetMode | null;
	readOnly: boolean;
	onModeChange: (mode: SheetMode) => void;
	onClose: () => void;
	onShare: (ingredient: Ingredient) => void;
	onDelete: (ingredient: Ingredient) => void;
	onCreated: (id: string) => void;
}

const EMPTY: Draft = { name: '', originalName: null, entries: [], active: null, tabs: [] };

export function IngredientSheet(props: IngredientSheetProps) {
	const { pouch, kind, ingredient, mode, readOnly } = props;
	const open = mode !== null;
	const files = useIngredientFiles(pouch.id, mode === 'create' ? null : ingredient);
	const [draft, setDraft] = useState<Draft>(EMPTY);
	// Applied synchronously so validation errors surface in the event handler that caused them.
	const dispatch = (action: DraftAction) => setDraft(draftReducer(draft, action));
	const [cursor, setCursor] = useState({ line: 1, column: 1 });
	const [prompt, setPrompt] = useState<{ kind: 'add' } | { kind: 'rename'; path: string } | null>(
		null,
	);
	const [confirmDiscard, setConfirmDiscard] = useState<null | (() => void)>(null);
	const [problem, setProblem] = useState<string | null>(null);
	const create = useCreateIngredient(pouch);
	const update = useUpdateIngredient(pouch);
	const saving = create.isPending || update.isPending;
	const saveError = create.error ?? update.error;

	// (Re)build the working copy whenever the panel opens on something new.
	useEffect(() => {
		setProblem(null);
		create.reset();
		update.reset();
		if (mode === 'create') {
			dispatch({
				type: 'reset',
				draft: createDraft(
					'',
					[
						{
							path: kind.mainFile,
							bytes: new TextEncoder().encode(kind.template(TEMPLATE_PLACEHOLDER)),
						},
					],
					{ isNew: true },
				),
			});
		} else if (ingredient && files.data) {
			dispatch({
				type: 'reset',
				draft: createDraft(
					ingredient.name,
					ingredient.files.map((entry) => ({
						path: entry.path,
						bytes: files.data.get(entry.path) ?? new Uint8Array(),
						mode: entry.mode,
					})),
					{ open: kind.mainFile },
				),
			});
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [mode === 'create', ingredient?.revisionId, files.data, kind.kind]);

	const editing = mode === 'edit' || mode === 'create';
	const activeEntry = draft.entries.find(
		(entry) => entry.path === draft.active && !entry.deleted,
	);

	const guard = (then: () => void) => {
		if (editing && isDirty(draft) && (mode === 'create' || changedCount(draft) > 0)) {
			setConfirmDiscard(() => then);
		} else then();
	};

	const save = async () => {
		setProblem(null);
		const nameProblem = validateName(draft.name);
		if (nameProblem) return setProblem(nameProblem);
		const result = draftFiles(draft);
		if ('problem' in result) return setProblem(result.problem);
		try {
			if (mode === 'create') {
				const created = await create.mutateAsync({
					kind: kind.kind,
					name: draft.name,
					files: result.files,
				});
				props.onCreated(created.revisionId);
			} else if (ingredient) {
				await update.mutateAsync({ ingredient, name: draft.name, files: result.files });
				props.onModeChange('show');
			}
		} catch {
			// Shown below the editor from the mutation state.
		}
	};

	const Icon = kind.icon;
	const loading = mode !== 'create' && (files.isPending || draft.entries.length === 0);

	return (
		<Sheet open={open} onOpenChange={(next) => !next && guard(props.onClose)}>
			<SheetContent
				title={
					mode === 'create'
						? `New ${kind.singular.toLowerCase()}`
						: (ingredient?.name ?? kind.singular)
				}
				hideTitle
				onEscapeKeyDown={(event) => {
					if (editing) {
						event.preventDefault();
						guard(props.onClose);
					}
				}}
			>
				<header className="flex items-center gap-3 border-b border-border px-4 py-3 sm:px-5">
					<Icon className="size-4 shrink-0 text-meta" aria-hidden />
					{editing ? (
						<Input
							aria-label="Item name"
							maxLength={NAME_MAX}
							value={draft.name}
							placeholder={`${kind.singular.toLowerCase()}-name`}
							onChange={(event) =>
								mode === 'create'
									? setDraft(
											renameFromTemplate(
												draft,
												event.target.value,
												kind.mainFile,
												kind.template,
											),
										)
									: dispatch({
											type: 'rename-ingredient',
											name: event.target.value,
										})
							}
							className="h-8 max-w-xs font-mono"
							autoFocus={mode === 'create'}
							spellCheck={false}
						/>
					) : (
						<div className="min-w-0 flex-1">
							<h2 className="truncate font-mono text-sm font-medium">
								{ingredient?.name}
							</h2>
							{ingredient ? (
								<p className="text-xs text-meta">
									{kind.singular} · {plural(ingredient.files.length, 'file')} ·{' '}
									{formatBytes(ingredient.size)} · Updated{' '}
									{formatRelative(ingredient.updatedAt)}
								</p>
							) : null}
						</div>
					)}
					<div className="ml-auto flex items-center gap-1.5">
						{mode === 'show' && ingredient && !readOnly ? (
							<>
								<Button size="sm" onClick={() => props.onModeChange('edit')}>
									<Pencil /> Edit
								</Button>
								<Button
									size="sm"
									variant="ghost"
									onClick={() => props.onShare(ingredient)}
								>
									<Share2 /> <span className="max-sm:sr-only">Share</span>
								</Button>
								<Button
									size="icon"
									variant="ghost"
									aria-label="Delete"
									onClick={() => props.onDelete(ingredient)}
								>
									<Trash2 />
								</Button>
							</>
						) : null}
						<button
							type="button"
							onClick={() => guard(props.onClose)}
							aria-label="Close"
							className="rounded-md p-1.5 text-muted hover:bg-hover hover:text-fg"
						>
							<X className="size-4" />
						</button>
					</div>
				</header>

				{loading ? (
					<LoadingBlock label="Decrypting files" />
				) : files.error ? (
					<ErrorMessage error={files.error} className="p-5" />
				) : (
					<div className="flex min-h-0 flex-1 flex-col md:flex-row">
						<aside className="hidden w-60 shrink-0 border-r border-border md:block">
							<FileTree
								entries={draft.entries}
								active={draft.active}
								editable={editing}
								onOpen={(path) => dispatch({ type: 'open', path })}
								onAdd={() => setPrompt({ kind: 'add' })}
								onRename={(path) => setPrompt({ kind: 'rename', path })}
								onDelete={(path) =>
									run(() => dispatch({ type: 'delete-file', path }), setProblem)
								}
								onRestore={(path) =>
									run(() => dispatch({ type: 'restore-file', path }), setProblem)
								}
							/>
						</aside>
						<MobileFilePicker
							draft={draft}
							onOpen={(path) => dispatch({ type: 'open', path })}
						/>
						<section className="flex min-h-0 min-w-0 flex-1 flex-col">
							<div
								role="tablist"
								className="flex h-9 shrink-0 overflow-x-auto border-b border-border"
							>
								{draft.tabs.map((tab) => {
									const entry = draft.entries.find(
										(candidate) => candidate.path === tab,
									);
									const dirty = entry && fileStatus(entry) !== 'unchanged';
									return (
										<div
											key={tab}
											className={cn(
												'group flex shrink-0 items-center gap-1.5 border-r border-border px-3 text-[13px]',
												tab === draft.active
													? 'bg-surface text-fg'
													: 'text-muted',
											)}
										>
											<button
												type="button"
												role="tab"
												aria-selected={tab === draft.active}
												onClick={() =>
													dispatch({ type: 'open', path: tab })
												}
												className="font-mono"
											>
												{tab.split('/').pop()}
											</button>
											{dirty && editing ? (
												<span
													className="size-1.5 rounded-full bg-warn"
													aria-label="unsaved"
												/>
											) : null}
											<button
												type="button"
												aria-label={`Close ${tab}`}
												onClick={() =>
													dispatch({ type: 'close-tab', path: tab })
												}
												className="rounded p-0.5 text-meta opacity-0 group-hover:opacity-100 hover:text-fg focus:opacity-100"
											>
												<X className="size-3" />
											</button>
										</div>
									);
								})}
							</div>
							<div className="min-h-0 flex-1">
								{activeEntry ? (
									activeEntry.text === null ? (
										<div className="flex h-full items-center justify-center text-[13px] text-muted">
											Preview not available for this file type.
										</div>
									) : (
										<CodeEditor
											value={activeEntry.text}
											language={languageOf(activeEntry.path)}
											readOnly={!editing}
											label={`Contents of ${activeEntry.path}`}
											onChange={(text) =>
												dispatch({
													type: 'edit',
													path: activeEntry.path,
													text,
												})
											}
											onCursor={setCursor}
										/>
									)
								) : (
									<div className="flex h-full items-center justify-center text-[13px] text-meta">
										Select a file
									</div>
								)}
							</div>
							<footer className="flex h-7 shrink-0 items-center justify-end gap-4 border-t border-border px-4 font-mono text-[11px] text-meta">
								{activeEntry ? (
									<>
										<span>{LANGUAGE_LABEL[languageOf(activeEntry.path)]}</span>
										<span>UTF-8 · LF</span>
										<span>
											Ln {cursor.line}, Col {cursor.column}
										</span>
									</>
								) : null}
							</footer>
						</section>
					</div>
				)}

				{editing ? (
					<div className="flex flex-col gap-3 border-t border-border px-4 py-3 sm:flex-row sm:items-center sm:px-5">
						<div className="flex-1">
							{problem ? (
								<p className="text-[13px] text-danger" role="alert">
									{problem}
								</p>
							) : saveError ? (
								<ErrorMessage error={saveError} />
							) : (
								<p className="text-[13px] text-muted">
									{mode === 'create'
										? 'Saved encrypted. Your computers get it on their next sync.'
										: changedCount(draft) === 0
											? 'No changes'
											: `${plural(changedCount(draft), 'file')} changed`}
								</p>
							)}
						</div>
						<div className="flex gap-2">
							<Button
								disabled={saving}
								onClick={() =>
									mode === 'create'
										? guard(props.onClose)
										: guard(() => props.onModeChange('show'))
								}
							>
								Discard
							</Button>
							<Button
								variant="primary"
								loading={saving}
								disabled={mode === 'edit' && changedCount(draft) === 0}
								onClick={() => void save()}
							>
								{mode === 'create'
									? `Add ${kind.singular.toLowerCase()}`
									: 'Save changes'}
							</Button>
						</div>
					</div>
				) : null}

				<PromptDialog
					open={prompt !== null}
					onOpenChange={(next) => !next && setPrompt(null)}
					title={prompt?.kind === 'rename' ? 'Rename file' : 'New file'}
					label="Path"
					description="Use “/” for folders, e.g. scripts/run.sh"
					initialValue={prompt?.kind === 'rename' ? prompt.path : ''}
					submitLabel={prompt?.kind === 'rename' ? 'Rename' : 'Create'}
					validate={validatePath}
					onSubmit={(path) =>
						prompt?.kind === 'rename'
							? dispatch({ type: 'rename-file', from: prompt.path, to: path })
							: dispatch({ type: 'add', path })
					}
				/>
				<ConfirmDialog
					open={confirmDiscard !== null}
					onOpenChange={(next) => !next && setConfirmDiscard(null)}
					title="Discard changes?"
					description="Your unsaved edits will be lost."
					confirmLabel="Discard"
					onConfirm={() => {
						const then = confirmDiscard;
						setConfirmDiscard(null);
						then?.();
					}}
				/>
			</SheetContent>
		</Sheet>
	);
}

/** Phones: the file tree becomes a dropdown above the editor. */
function MobileFilePicker({ draft, onOpen }: { draft: Draft; onOpen: (path: string) => void }) {
	const live = draft.entries.filter((entry) => !entry.deleted);
	if (live.length < 2) return null;
	return (
		<div className="border-b border-border p-2 md:hidden">
			<select
				aria-label="File"
				value={draft.active ?? ''}
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

/** Runs a reducer action that may throw a validation error. */
function run(action: () => void, report: (message: string | null) => void) {
	try {
		report(null);
		action();
	} catch (error) {
		report((error as Error).message);
	}
}
