// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Per-pouch key hierarchy.
 *
 *   Pouch Secret PS_g (32 random bytes, one per key generation g)
 *     ├─ K_content = BLAKE3.derive_key("skillpouch/v1/content", PS_g)   file contents
 *     ├─ K_meta    = BLAKE3.derive_key("skillpouch/v1/meta",    PS_g)   revision envelopes, pouch name
 *     └─ K_binding = BLAKE3.derive_key("skillpouch/v1/binding", PS_g)   where files are installed
 *
 *   Pouch Identity Secret PIS (32 random bytes, stable for the pouch's life)
 *     ├─ K_blob_id = BLAKE3.derive_key("skillpouch/v1/blob-id",    PIS)  dedup-friendly blob ids
 *     └─ K_name    = BLAKE3.derive_key("skillpouch/v1/name-index", PIS)  blind name index
 *
 * PS_g rotates whenever a member is removed; PIS never rotates, so blob ids
 * and name indexes stay stable across generations.
 */
import { blake3 } from '@noble/hashes/blake3.js';
import { b64, concat, randomBytes, utf8 } from './bytes';
import { CryptoError } from './errors';

export interface PouchGeneration {
	keyGen: number;
	content: Uint8Array;
	meta: Uint8Array;
	binding: Uint8Array;
}

export interface PouchKeys {
	pouchId: string;
	/** Highest generation this member holds — new writes always use it. */
	current: PouchGeneration;
	/** Every generation this member can read, by number. */
	generations: Map<number, PouchGeneration>;
	blobIdKey: Uint8Array;
	nameKey: Uint8Array;
}

/** The 64 bytes sealed into every key envelope: `PS_g ‖ PIS`. */
export interface PouchSecretMaterial {
	ps: Uint8Array;
	pis: Uint8Array;
}

const deriveKey = (context: string, material: Uint8Array) =>
	blake3
		.create({ context: utf8(context), dkLen: 32 })
		.update(material)
		.digest();

export function newPouchSecrets(pis?: Uint8Array): PouchSecretMaterial {
	return { ps: randomBytes(32), pis: pis ?? randomBytes(32) };
}

export function packSecrets(material: PouchSecretMaterial): Uint8Array {
	return concat(material.ps, material.pis);
}

export function unpackSecrets(bytes: Uint8Array): PouchSecretMaterial {
	if (bytes.length !== 64) throw new CryptoError('format_unsupported', 'bad key material length');
	return { ps: bytes.slice(0, 32), pis: bytes.slice(32) };
}

export function deriveGeneration(keyGen: number, ps: Uint8Array): PouchGeneration {
	return {
		keyGen,
		content: deriveKey('skillpouch/v1/content', ps),
		meta: deriveKey('skillpouch/v1/meta', ps),
		binding: deriveKey('skillpouch/v1/binding', ps),
	};
}

/** Builds the key ring of one pouch from the opened envelopes (any order, ≥ 1). */
export function buildPouchKeys(
	pouchId: string,
	opened: { keyGen: number; material: PouchSecretMaterial }[],
): PouchKeys {
	const first = opened[0];
	if (!first) throw new CryptoError('wrong_secret', `no key envelopes for pouch ${pouchId}`);
	const generations = new Map<number, PouchGeneration>();
	for (const { keyGen, material } of opened) {
		generations.set(keyGen, deriveGeneration(keyGen, material.ps));
	}
	const newest = Math.max(...generations.keys());
	return {
		pouchId,
		current: generations.get(newest)!,
		generations,
		blobIdKey: deriveKey('skillpouch/v1/blob-id', first.material.pis),
		nameKey: deriveKey('skillpouch/v1/name-index', first.material.pis),
	};
}

export function generation(keys: PouchKeys, keyGen: number): PouchGeneration {
	const found = keys.generations.get(keyGen);
	if (!found) {
		throw new CryptoError('wrong_secret', `key generation ${keyGen} is not available`);
	}
	return found;
}

/** `blob_id = BLAKE3.keyed_hash(K_blob_id, plaintext)` — same file, same pouch → same id. */
export function blobId(keys: PouchKeys, plaintext: Uint8Array): string {
	return b64(blake3(plaintext, { key: keys.blobIdKey }));
}

/** Case- and normalization-insensitive form of an artifact name. */
export function foldName(logicalKey: string): string {
	return logicalKey.normalize('NFC').toLowerCase();
}

/**
 * `name_index = BLAKE3.keyed_hash(K_name, "v1" ‖ kind ‖ 0x00 ‖ scope ‖ 0x00 ‖ fold(logical_key))`.
 * The server enforces uniqueness on it without learning the name.
 */
export function nameIndex(
	keys: PouchKeys,
	kind: string,
	scope: string,
	logicalKey: string,
): string {
	const zero = new Uint8Array([0]);
	return b64(
		blake3(concat('v1', kind, zero, scope, zero, foldName(logicalKey)), { key: keys.nameKey }),
	);
}
