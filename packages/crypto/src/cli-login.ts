// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The E2EE half of "Authorize CLI".
 *
 * - **Confirm code**: 8 digits both the terminal and the browser compute from
 *   the CLI's public keys. A server that swapped the keys would change it.
 * - **Welcome**: HPKE-sealed to the CLI's `enc_pub`; tells it which roster
 *   to trust (genesis hash + head) so the server can't hand it a fake one.
 */
import { blake3 } from '@noble/hashes/blake3.js';
import { canonicalJson } from '@skillpouch/contracts';
import { b64, concat, fromUtf8, unb64, utf8 } from './bytes';
import { CryptoError } from './errors';
import { hpkeOpen, hpkeSeal, type HpkeRecipientKey } from './hpke';
import type { PublicJwk } from './keys';

export function confirmCode(
	requestId: string,
	signPub: PublicJwk,
	encPub: PublicJwk,
	jkt: string,
): string {
	const digest = blake3(
		concat(
			'skillpouch/v1/cli-confirm',
			requestId,
			canonicalJson(signPub),
			canonicalJson(encPub),
			jkt,
		),
	);
	const value = new DataView(digest.buffer, digest.byteOffset, 8).getBigUint64(0, false);
	const digits = (value % 100_000_000n).toString().padStart(8, '0');
	return `${digits.slice(0, 4)}-${digits.slice(4)}`;
}

export interface Welcome {
	format: 1;
	account_id: string;
	genesis_hash: string;
	roster_head_seq: number;
	roster_head_hash: string;
	member_id: string;
}

const WELCOME_INFO = utf8('skillpouch/v1/welcome');

export async function sealWelcome(cliEncPub: PublicJwk, welcome: Welcome): Promise<string> {
	const sealed = await hpkeSeal(
		cliEncPub,
		WELCOME_INFO,
		utf8(welcome.member_id),
		utf8(canonicalJson(welcome)),
	);
	return b64(concat(sealed.enc, sealed.ciphertext));
}

export async function openWelcome(
	cliKey: HpkeRecipientKey,
	memberId: string,
	sealedB64: string,
): Promise<Welcome> {
	const bytes = unb64(sealedB64);
	if (bytes.length < 65 + 16) throw new CryptoError('format_unsupported', 'welcome too short');
	const plaintext = await hpkeOpen(
		cliKey,
		{ enc: bytes.subarray(0, 65), ciphertext: bytes.subarray(65) },
		WELCOME_INFO,
		utf8(memberId),
	);
	const welcome = JSON.parse(fromUtf8(plaintext)) as Welcome;
	if (welcome.format !== 1 || welcome.member_id !== memberId) {
		throw new CryptoError('envelope_mismatch', 'welcome is not for this device');
	}
	return welcome;
}
