// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Revision envelopes carry everything the server must not see about a
 * version of an artifact: its kind, name and file manifest.
 *
 *   envelope  = seal(K_meta_g, canonical JSON body,
 *                    aad = "skillpouch/v1/revision" ‖ pouch_id ‖ artifact_id ‖ revision_id)
 *   signature = sign(author, "skillpouch/v1/revision-sig",
 *                    pouch_id ‖ revision_id ‖ BLAKE3(envelope))
 *
 * Readers verify the signature against a member that was active when the
 * revision was written, decrypt, and check that the ids inside match the
 * server's columns (so the server can't swap envelopes between artifacts).
 */
import { blake3 } from '@noble/hashes/blake3.js';
import { canonicalJson } from '@skillpouch/contracts';
import { b64, concat, fromUtf8, unb64, utf8 } from './bytes';
import { CryptoError } from './errors';
import { requireSignature, sign, type PublicJwk } from './keys';
import { generation, type PouchKeys } from './pouch-keys';
import { open, seal, sealedKeyGen } from './sealed';

export const REVISION_SIG_CONTEXT = 'skillpouch/v1/revision-sig';

export interface ManifestEntry {
	path: string;
	blob: string;
	size: number;
	mode: 'file' | 'exec';
}

export interface RevisionBody {
	format: 1;
	artifact_id: string;
	revision_id: string;
	parent_id: string | null;
	merge_parent_id: string | null;
	kind: string;
	scope: string;
	logical_key: string;
	deleted: boolean;
	entries: ManifestEntry[];
	roster_head: string;
	author_member_id: string;
	created_at: string;
}

export interface SealedRevision {
	envelope: string;
	signature: string;
	keyGen: number;
}

const revisionAad = (pouchId: string, artifactId: string, revisionId: string) =>
	concat('skillpouch/v1/revision', pouchId, artifactId, revisionId);

const signedMessage = (pouchId: string, revisionId: string, envelope: Uint8Array) =>
	concat(pouchId, revisionId, blake3(envelope));

export async function sealRevision(
	keys: PouchKeys,
	author: { signKey: CryptoKey },
	body: RevisionBody,
): Promise<SealedRevision> {
	const entries = [...body.entries].sort((a, b) =>
		a.path < b.path ? -1 : a.path > b.path ? 1 : 0,
	);
	const normalized: RevisionBody = {
		...body,
		logical_key: body.logical_key.normalize('NFC'),
		entries,
	};
	const envelope = seal(
		keys.current.meta,
		keys.current.keyGen,
		utf8(canonicalJson(normalized)),
		revisionAad(keys.pouchId, body.artifact_id, body.revision_id),
	);
	const signature = await sign(
		author.signKey,
		REVISION_SIG_CONTEXT,
		signedMessage(keys.pouchId, body.revision_id, envelope),
	);
	return { envelope: b64(envelope), signature, keyGen: keys.current.keyGen };
}

/** The server columns a decrypted body must agree with. */
export interface RevisionColumns {
	artifact_id: string;
	revision_id: string;
	parent_id: string | null;
	envelope: string;
	signature: string;
	signer_member_id: string;
}

export async function openRevision(
	keys: PouchKeys,
	columns: RevisionColumns,
	signerSignPub: PublicJwk,
): Promise<RevisionBody> {
	const envelope = unb64(columns.envelope);
	await requireSignature(
		signerSignPub,
		columns.signature,
		REVISION_SIG_CONTEXT,
		signedMessage(keys.pouchId, columns.revision_id, envelope),
		'revision',
	);
	const gen = generation(keys, sealedKeyGen(envelope));
	const plaintext = open(
		gen.meta,
		envelope,
		revisionAad(keys.pouchId, columns.artifact_id, columns.revision_id),
	);
	const body = JSON.parse(fromUtf8(plaintext)) as RevisionBody;
	if (body.format !== 1) throw new CryptoError('format_unsupported', 'unknown revision format');
	if (
		body.artifact_id !== columns.artifact_id ||
		body.revision_id !== columns.revision_id ||
		body.parent_id !== columns.parent_id ||
		body.author_member_id !== columns.signer_member_id
	) {
		throw new CryptoError('envelope_mismatch', 'revision envelope does not match its record');
	}
	return body;
}
