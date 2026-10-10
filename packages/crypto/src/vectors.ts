// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Deterministic test vectors for the v1 formats. The committed
 * `vectors/v1.json` is what the Rust CLI must reproduce byte for byte;
 * `test/vectors.test.ts` keeps this implementation honest against it.
 */
import { b64, utf8 } from './bytes';
import { confirmCode } from './cli-login';
import { jwkThumbprint, type PublicJwk } from './keys';
import { padmeLength } from './padding';
import { blobId, buildPouchKeys, nameIndex } from './pouch-keys';
import { seal } from './sealed';
import { memberSeed, passkeyMemberKeys, prfInput, secretMemberKeys } from './secrets';

const fill = (length: number, start: number) =>
	Uint8Array.from({ length }, (_, i) => (start + i) & 0xff);

export async function computeVectors() {
	const pouchId = '01920000-0000-7000-8000-00000000a001';
	const ps = fill(32, 1);
	const pis = fill(32, 101);
	const keys = buildPouchKeys(pouchId, [{ keyGen: 3, material: { ps, pis } }]);
	const content = utf8('---\nname: pdf-tools\n---\n# PDF tools\n');
	const secret = fill(64, 7);
	const salt = fill(16, 200);
	const member = await secretMemberKeys('password', secret, salt);
	const prfOutput = fill(32, 150);
	const passkey = await passkeyMemberKeys(prfOutput, salt);
	const cliSign: PublicJwk = member.signPub;
	const cliEnc: PublicJwk = member.encPub;

	return {
		format: 1,
		padme: [0, 1, 2, 9, 100, 1000, 4097, 65_537].map((length) => ({
			length,
			padded: padmeLength(length),
		})),
		pouch_keys: {
			pouch_id: pouchId,
			key_gen: 3,
			ps: b64(ps),
			pis: b64(pis),
			k_content: b64(keys.current.content),
			k_meta: b64(keys.current.meta),
			k_binding: b64(keys.current.binding),
			k_blob_id: b64(keys.blobIdKey),
			k_name: b64(keys.nameKey),
		},
		blob: {
			plaintext: b64(content),
			blob_id: blobId(keys, content),
			nonce: b64(fill(24, 50)),
			sealed: b64(
				seal(keys.current.content, 3, content, utf8('aad'), { nonce: fill(24, 50) }),
			),
			aad_utf8: 'aad',
		},
		name_index: [
			{ kind: 'skill', scope: 'global', logical_key: 'PDF-Tools' },
			{ kind: 'mcp_server', scope: 'global', logical_key: 'Ünïcode' },
		].map((input) => ({
			...input,
			name_index: nameIndex(keys, input.kind, input.scope, input.logical_key),
		})),
		member_seed: {
			kind: 'password',
			secret: b64(secret),
			member_salt: b64(salt),
			seed: b64(memberSeed('password', secret, salt)),
			sign_pub: member.signPub,
			enc_pub: member.encPub,
			sign_jkt: jwkThumbprint(member.signPub),
		},
		passkey_seed: {
			member_salt: b64(salt),
			prf_input: b64(prfInput(salt)),
			prf_output: b64(prfOutput),
			seed: b64(memberSeed('passkey', prfOutput, salt)),
			sign_pub: passkey.signPub,
			enc_pub: passkey.encPub,
		},
		confirm_code: {
			request_id: '01920000-0000-7000-8000-00000000c0de',
			code: confirmCode(
				'01920000-0000-7000-8000-00000000c0de',
				cliSign,
				cliEnc,
				jwkThumbprint(cliSign),
			),
		},
	};
}
