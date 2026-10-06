// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A pouch's display name and description live in its roster statement
 * (`create_pouch` / `rename_pouch`), sealed with that pouch's `K_meta`:
 *
 *   name_enc = seal(K_meta_g, { name, description }, aad = "skillpouch/v1/pouch-name" ‖ pouch_id)
 */
import { b64, concat, fromUtf8, unb64, utf8 } from './bytes';
import { CryptoError } from './errors';
import { generation, type PouchKeys } from './pouch-keys';
import { open, seal, sealedKeyGen } from './sealed';

export interface PouchMeta {
	name: string;
	description: string;
}

/** Keeps the sealed name under the roster's 1 KiB field limit. */
export const POUCH_NAME_MAX = 64;
export const POUCH_DESCRIPTION_MAX = 280;

const aad = (pouchId: string) => concat('skillpouch/v1/pouch-name', pouchId);

export function sealPouchMeta(keys: PouchKeys, meta: PouchMeta): string {
	const name = meta.name.trim().slice(0, POUCH_NAME_MAX);
	const description = meta.description.trim().slice(0, POUCH_DESCRIPTION_MAX);
	if (!name) throw new CryptoError('format_unsupported', 'a pouch needs a name');
	return b64(
		seal(
			keys.current.meta,
			keys.current.keyGen,
			utf8(JSON.stringify({ name, description })),
			aad(keys.pouchId),
		),
	);
}

export function openPouchMeta(keys: PouchKeys, nameEnc: string): PouchMeta {
	const sealed = unb64(nameEnc);
	const plaintext = open(generation(keys, sealedKeyGen(sealed)).meta, sealed, aad(keys.pouchId));
	const parsed = JSON.parse(fromUtf8(plaintext)) as Partial<PouchMeta>;
	return { name: String(parsed.name ?? ''), description: String(parsed.description ?? '') };
}
