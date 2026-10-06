// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Share links. The sender encrypts a snapshot of one item with a fresh
 * random key that only travels in the link's fragment
 * (`https://skillpouch.net/s/<id>#<key>`): browsers never send fragments to
 * servers, so SkillPouch stores ciphertext it cannot read.
 *
 *   bundle = seal(K_share, { kind, name, files[] }, aad = "skillpouch/v1/share" ‖ share_id)
 *
 * Secrets in MCP server and hook configs are stripped by the caller before
 * sealing; the recipient fills them in.
 */
import { b64, concat, fromUtf8, randomBytes, unb64, utf8 } from './bytes';
import { CryptoError } from './errors';
import { open, seal } from './sealed';

export interface ShareFile {
	path: string;
	/** base64url file content. */
	content: string;
	mode: 'file' | 'exec';
}

export interface ShareBundle {
	format: 1;
	kind: string;
	name: string;
	description: string;
	files: ShareFile[];
	/** Keys whose values were removed (e.g. `env.GITHUB_TOKEN`). */
	stripped: string[];
	shared_at: string;
}

const aad = (shareId: string) => concat('skillpouch/v1/share', shareId);

export function newShareKey(): string {
	return b64(randomBytes(32));
}

export function sealShare(shareId: string, keyB64: string, bundle: ShareBundle): Uint8Array {
	return seal(unb64(keyB64), 1, utf8(JSON.stringify(bundle)), aad(shareId));
}

export function openShare(shareId: string, keyB64: string, sealed: Uint8Array): ShareBundle {
	const key = unb64(keyB64);
	if (key.length !== 32) throw new CryptoError('wrong_secret', 'the link key is incomplete');
	const bundle = JSON.parse(fromUtf8(open(key, sealed, aad(shareId)))) as ShareBundle;
	if (bundle.format !== 1) throw new CryptoError('format_unsupported', 'unknown share format');
	return bundle;
}
