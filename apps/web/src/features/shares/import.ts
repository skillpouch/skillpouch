// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Adding a shared ingredient to one of your pouches: the bundle's files are
 * re-encrypted with that pouch's keys and committed like any other edit.
 */
import { unb64, type ShareBundle } from '@skillpouch/crypto';
import { addToPouch, type DuplicateChoice } from '../ingredients/add-to-pouch';
import { asText, fillSecrets } from '../ingredients/content';
import { isIngredientKind } from '../ingredients/kinds';
import type { DraftFile } from '../ingredients/write';
import type { PouchView } from '../pouches/pouches';
import { recordImport } from './shares';

export { appendFiles, freeName, type DuplicateChoice } from '../ingredients/add-to-pouch';

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
	const { bundle } = input;
	if (!isIngredientKind(bundle.kind))
		throw new Error('This link contains an unsupported item type.');
	const result = await addToPouch({
		pouch: input.pouch,
		kind: bundle.kind,
		name: bundle.name,
		files: bundleFiles(bundle, input.secrets),
		duplicate: input.duplicate,
	});
	if (!input.oneTime) await recordImport(input.shareId).catch(() => undefined);
	return result;
}
