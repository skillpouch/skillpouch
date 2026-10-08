// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Adding finished files to a pouch from outside the editor — a share link or
 * a marketplace. The files are encrypted with that pouch's keys and committed
 * like any other edit; a name already in use is kept, replaced or appended to.
 */
import type { PouchView } from '../pouches/pouches';
import { currentKeyring } from '../session/session-store';
import {
	fetchIngredientFiles,
	inScope,
	loadPouchContents,
	newestFirst,
	type Ingredient,
} from './ingredients';
import { kindDefinition, type IngredientKind } from './kinds';
import { commitIngredient, type DraftFile } from './write';

export type DuplicateChoice = 'keep_both' | 'replace' | 'append';

/** `name` → `name-2`, `name-3`, … until it is free in the pouch. */
export function freeName(name: string, taken: Set<string>): string {
	if (!taken.has(name.toLowerCase())) return name;
	for (let index = 2; ; index++) {
		const candidate = `${name}-${index}`;
		if (!taken.has(candidate.toLowerCase())) return candidate;
	}
}

/**
 * `incoming` added to `current`: the main files are joined with a blank line,
 * other files are added unless one with the same path exists.
 */
export function appendFiles(
	current: DraftFile[],
	incoming: DraftFile[],
	mainFile: string,
): DraftFile[] {
	const decoder = new TextDecoder();
	const encoder = new TextEncoder();
	const incomingMain = incoming.find((file) => file.path === mainFile);
	const merged = current.map((file) =>
		file.path === mainFile && incomingMain
			? {
					...file,
					bytes: encoder.encode(
						`${decoder.decode(file.bytes).trimEnd()}\n\n${decoder.decode(incomingMain.bytes)}`,
					),
				}
			: file,
	);
	const paths = new Set(current.map((file) => file.path));
	return [...merged, ...incoming.filter((file) => !paths.has(file.path))];
}

export async function addToPouch(input: {
	pouch: PouchView;
	kind: IngredientKind;
	name: string;
	files: DraftFile[];
	duplicate: DuplicateChoice;
}): Promise<{ name: string }> {
	const { pouch, kind } = input;
	const keyring = currentKeyring();
	const contents = await loadPouchContents(keyring, pouch.id);
	const sameKind = inScope(contents.ingredients).filter((item) => item.kind === kind);
	const definition = kindDefinition(kind);
	const single = definition?.single;
	let files = input.files;

	// A pouch has one set of instructions: an addition goes into it.
	if (single) {
		const [existing] = newestFirst(sameKind);
		if (existing && input.duplicate === 'append') {
			files = appendFiles(
				await currentFiles(keyring, pouch.id, existing),
				files,
				definition.mainFile,
			);
		}
		await commitIngredient(
			existing
				? {
						keyring,
						pouch,
						type: 'update',
						artifactId: existing.id,
						base: existing,
						kind: existing.kind,
						scope: existing.scope,
						name: existing.name,
						files,
					}
				: {
						keyring,
						pouch,
						type: 'create',
						artifactId: crypto.randomUUID(),
						base: null,
						kind,
						name: single,
						files,
					},
		);
		return { name: existing?.name ?? single };
	}

	const existing = sameKind.find((item) => item.name.toLowerCase() === input.name.toLowerCase());
	if (existing && input.duplicate === 'replace') {
		await commitIngredient({
			keyring,
			pouch,
			type: 'update',
			artifactId: existing.id,
			base: existing,
			kind: existing.kind,
			scope: existing.scope,
			name: existing.name,
			files,
		});
		return { name: existing.name };
	}
	const name = freeName(input.name, new Set(sameKind.map((item) => item.name.toLowerCase())));
	await commitIngredient({
		keyring,
		pouch,
		type: 'create',
		artifactId: crypto.randomUUID(),
		base: null,
		kind,
		name,
		files,
	});
	return { name };
}

async function currentFiles(
	keyring: ReturnType<typeof currentKeyring>,
	pouchId: string,
	ingredient: Ingredient,
): Promise<DraftFile[]> {
	const bytes = await fetchIngredientFiles(keyring, pouchId, ingredient);
	return ingredient.files.map((entry) => ({
		path: entry.path,
		bytes: bytes.get(entry.path) ?? new Uint8Array(),
		mode: entry.mode,
	}));
}
