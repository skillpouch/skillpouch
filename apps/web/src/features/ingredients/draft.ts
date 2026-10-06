// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The editor's working copy of an ingredient: its files with their original
 * and edited content. A pure reducer, so every edit rule is unit-tested
 * without rendering anything.
 */
import { asText } from './content';
import { validatePath } from './kinds';
import type { DraftFile } from './write';

export const MAX_FILE_BYTES = 1024 * 1024;
export const MAX_INGREDIENT_BYTES = 20 * 1024 * 1024;
export const MAX_FILES = 2000;

export interface DraftEntry {
	path: string;
	/** Path in the saved version; null for files added in this draft. */
	originalPath: string | null;
	/** Editable text, or null for binary files (kept as they are). */
	text: string | null;
	originalText: string | null;
	/** Binary content (or the original bytes of a text file). */
	bytes: Uint8Array;
	mode: 'file' | 'exec';
	deleted: boolean;
}

export interface Draft {
	name: string;
	originalName: string | null;
	entries: DraftEntry[];
	/** File currently open in the editor. */
	active: string | null;
	/** Open tabs, in order. */
	tabs: string[];
}

export type FileStatus = 'new' | 'modified' | 'deleted' | 'unchanged';

export function fileStatus(entry: DraftEntry): FileStatus {
	if (entry.deleted) return 'deleted';
	if (entry.originalPath === null) return 'new';
	if (entry.path !== entry.originalPath || entry.text !== entry.originalText) return 'modified';
	return 'unchanged';
}

export function createDraft(
	name: string,
	files: { path: string; bytes: Uint8Array; mode?: 'file' | 'exec' }[],
	options: { isNew?: boolean; open?: string } = {},
): Draft {
	const entries = files
		.map<DraftEntry>((file) => {
			const text = asText(file.bytes);
			return {
				path: file.path,
				originalPath: options.isNew ? null : file.path,
				text,
				originalText: options.isNew ? null : text,
				bytes: file.bytes,
				mode: file.mode ?? 'file',
				deleted: false,
			};
		})
		.sort((a, b) => a.path.localeCompare(b.path));
	const active = options.open ?? entries[0]?.path ?? null;
	return {
		name,
		originalName: options.isNew ? null : name,
		entries,
		active,
		tabs: active ? [active] : [],
	};
}

export type DraftAction =
	| { type: 'rename-ingredient'; name: string }
	| { type: 'open'; path: string }
	| { type: 'close-tab'; path: string }
	| { type: 'edit'; path: string; text: string }
	| { type: 'add'; path: string; text?: string }
	| { type: 'rename-file'; from: string; to: string }
	| { type: 'delete-file'; path: string }
	| { type: 'restore-file'; path: string }
	| { type: 'reset'; draft: Draft };

/** Placeholder used in a new item's template until the user picks a name. */
export const TEMPLATE_PLACEHOLDER = 'new-item';

/**
 * Renames a new item and, while its main file still holds the untouched
 * template, rewrites the template with the new name. Once the user edits the
 * file, their text is never replaced.
 */
export function renameFromTemplate(
	draft: Draft,
	name: string,
	mainFile: string,
	template: (name: string) => string,
): Draft {
	const renamed = draftReducer(draft, { type: 'rename-ingredient', name });
	const main = live(draft, mainFile);
	const previous = template(draft.name.trim() || TEMPLATE_PLACEHOLDER);
	if (!main || main.text !== previous) return renamed;
	return draftReducer(renamed, {
		type: 'edit',
		path: mainFile,
		text: template(name.trim() || TEMPLATE_PLACEHOLDER),
	});
}

/** Validation errors are returned, not thrown, so the UI can show them inline. */
export class DraftError extends Error {}

const encoder = new TextEncoder();

function live(draft: Draft, path: string): DraftEntry | undefined {
	return draft.entries.find((entry) => entry.path === path && !entry.deleted);
}

export function draftReducer(draft: Draft, action: DraftAction): Draft {
	switch (action.type) {
		case 'reset':
			return action.draft;
		case 'rename-ingredient':
			return { ...draft, name: action.name };
		case 'open':
			if (!live(draft, action.path)) return draft;
			return {
				...draft,
				active: action.path,
				tabs: draft.tabs.includes(action.path) ? draft.tabs : [...draft.tabs, action.path],
			};
		case 'close-tab': {
			const tabs = draft.tabs.filter((tab) => tab !== action.path);
			const active =
				draft.active === action.path ? (tabs[tabs.length - 1] ?? null) : draft.active;
			return { ...draft, tabs, active };
		}
		case 'edit':
			return {
				...draft,
				entries: draft.entries.map((entry) =>
					entry.path === action.path && !entry.deleted && entry.text !== null
						? { ...entry, text: action.text }
						: entry,
				),
			};
		case 'add': {
			const problem = validatePath(action.path) ?? conflictProblem(draft, action.path);
			if (problem) throw new DraftError(problem);
			const text = action.text ?? '';
			const entry: DraftEntry = {
				path: action.path,
				originalPath: null,
				text,
				originalText: null,
				bytes: encoder.encode(text),
				mode: 'file',
				deleted: false,
			};
			return draftReducer(
				{
					...draft,
					entries: [...draft.entries, entry].sort((a, b) => a.path.localeCompare(b.path)),
				},
				{ type: 'open', path: action.path },
			);
		}
		case 'rename-file': {
			if (action.from === action.to) return draft;
			const problem = validatePath(action.to) ?? conflictProblem(draft, action.to);
			if (problem) throw new DraftError(problem);
			return {
				...draft,
				entries: draft.entries
					.map((entry) =>
						entry.path === action.from && !entry.deleted
							? { ...entry, path: action.to }
							: entry,
					)
					.sort((a, b) => a.path.localeCompare(b.path)),
				tabs: draft.tabs.map((tab) => (tab === action.from ? action.to : tab)),
				active: draft.active === action.from ? action.to : draft.active,
			};
		}
		case 'delete-file': {
			const remaining = draft.entries.filter(
				(entry) => !entry.deleted && entry.path !== action.path,
			);
			if (remaining.length === 0)
				throw new DraftError('An ingredient needs at least one file.');
			const entries = draft.entries
				.map((entry) =>
					entry.path === action.path && !entry.deleted
						? entry.originalPath === null
							? null
							: { ...entry, deleted: true }
						: entry,
				)
				.filter((entry): entry is DraftEntry => entry !== null);
			return draftReducer({ ...draft, entries }, { type: 'close-tab', path: action.path });
		}
		case 'restore-file': {
			if (live(draft, action.path))
				throw new DraftError('A file with this name already exists.');
			return {
				...draft,
				entries: draft.entries.map((entry) =>
					entry.path === action.path && entry.deleted
						? { ...entry, deleted: false }
						: entry,
				),
			};
		}
		default:
			return draft;
	}
}

function conflictProblem(draft: Draft, path: string): string | null {
	const lower = path.toLowerCase();
	for (const entry of draft.entries) {
		if (entry.deleted) continue;
		const other = entry.path.toLowerCase();
		if (other === lower) return 'A file with this name already exists.';
		if (other.startsWith(`${lower}/`) || lower.startsWith(`${other}/`)) {
			return 'A file and a folder can’t share a name.';
		}
	}
	return null;
}

export function changedCount(draft: Draft): number {
	return (
		draft.entries.filter((entry) => fileStatus(entry) !== 'unchanged').length +
		(draft.originalName !== null && draft.name !== draft.originalName ? 1 : 0)
	);
}

export function isDirty(draft: Draft): boolean {
	return draft.originalName === null || changedCount(draft) > 0;
}

/** The files to save, or the first problem that prevents saving. */
export function draftFiles(draft: Draft): { files: DraftFile[] } | { problem: string } {
	const files: DraftFile[] = draft.entries
		.filter((entry) => !entry.deleted)
		.map((entry) => ({
			path: entry.path,
			bytes: entry.text === null ? entry.bytes : encoder.encode(entry.text),
			mode: entry.mode,
		}));
	if (files.length === 0) return { problem: 'An ingredient needs at least one file.' };
	if (files.length > MAX_FILES) return { problem: `At most ${MAX_FILES} files.` };
	const big = files.find((file) => file.bytes.length > MAX_FILE_BYTES);
	if (big) return { problem: `${big.path} is larger than 1 MB.` };
	const total = files.reduce((sum, file) => sum + file.bytes.length, 0);
	if (total > MAX_INGREDIENT_BYTES)
		return { problem: 'All files together are larger than 20 MB.' };
	return { files };
}
