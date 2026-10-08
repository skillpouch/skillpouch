// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Adding a shared ingredient to one of your pouches: the bundle's files are
 * re-encrypted with that pouch's keys and committed like any other edit.
 */
import { unb64, type ShareBundle } from '@skillpouch/crypto';
import { asText, fillSecrets } from '../ingredients/content';
import {
	fetchIngredientFiles,
	inScope,
	loadPouchContents,
	newestFirst,
	type Ingredient,
} from '../ingredients/ingredients';
import { isIngredientKind, kindDefinition } from '../ingredients/kinds';
import { commitIngredient, type DraftFile } from '../ingredients/write';
import type { PouchView } from '../pouches/pouches';
import { currentKeyring } from '../session/session-store';
import { recordImport } from './shares';

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

/** Secret values per file, keyed like `stripped`: `<path>:<dotted.key>`. */
export function bundleFiles(bundle: ShareBundle, secrets: Record<string, string>): DraftFile[] {
	const encoder = new TextEncoder();
	return bundle.files.map((file) => {
		let bytes = unb64(file.content);
		const values = Object.fromEntries(
			Object.entries(secrets)
				.filter(([key, value]) => key.startsWith(`${file.path}:`) && value !== '')
				.map(([key, value]) => [key.slice(file.path.length + 1), value]),
		);
		const text = asText(bytes);
		if (text !== null && Object.keys(values).length > 0) {
			bytes = encoder.encode(fillSecrets(text, values));
		}
		return { path: file.path, bytes, mode: file.mode };
	});
}

export async function importBundle(input: {
	shareId: string;
	oneTime: boolean;
	bundle: ShareBundle;
	pouch: PouchView;
	duplicate: DuplicateChoice;
	secrets: Record<string, string>;
}): Promise<{ name: string }> {
	const { bundle, pouch } = input;
	if (!isIngredientKind(bundle.kind))
		throw new Error('This link contains an unsupported item type.');
	const keyring = currentKeyring();
	const contents = await loadPouchContents(keyring, pouch.id);
	const sameKind = inScope(contents.ingredients).filter((item) => item.kind === bundle.kind);
	const definition = kindDefinition(bundle.kind);
	const single = definition?.single;
	let files = bundleFiles(bundle, input.secrets);

	// A pouch has one set of instructions: an import goes into it.
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
						kind: bundle.kind,
						name: single,
						files,
					},
		);
		if (!input.oneTime) await recordImport(input.shareId).catch(() => undefined);
		return { name: existing?.name ?? single };
	}

	const existing = sameKind.find((item) => item.name.toLowerCase() === bundle.name.toLowerCase());
	let name = bundle.name;
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
	} else {
		name = freeName(bundle.name, new Set(sameKind.map((item) => item.name.toLowerCase())));
		await commitIngredient({
			keyring,
			pouch,
			type: 'create',
			artifactId: crypto.randomUUID(),
			base: null,
			kind: bundle.kind,
			name,
			files,
		});
	}
	if (!input.oneTime) await recordImport(input.shareId).catch(() => undefined);
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
