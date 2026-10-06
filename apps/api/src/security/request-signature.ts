// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Detached device signature over a commit's request digest (plan 08 §3.4):
 * `Skillpouch-Signature: <protected header>..<signature>` — a compact JWS
 * (ES256) whose payload is base64url(BLAKE3(canonical request body)). Stored
 * in the operation receipt as non-repudiable proof of which device called.
 */
import { toBase64Url } from '@skillpouch/contracts';
import { compactVerify, importJWK } from 'jose';
import { AppError } from '../http/app-error';

export async function verifyDetachedSignature(
	header: string | undefined,
	digest: Uint8Array,
	publicJwk: Record<string, string>,
): Promise<string> {
	if (!header)
		throw new AppError('signature_invalid', { reason: 'Skillpouch-Signature header required' });
	const parts = header.split('.');
	if (parts.length !== 3 || parts[1] !== '')
		throw new AppError('signature_invalid', { reason: 'malformed' });
	try {
		const key = await importJWK({ ...publicJwk, kty: 'EC', crv: 'P-256' }, 'ES256');
		await compactVerify(`${parts[0]}.${toBase64Url(digest)}.${parts[2]}`, key, {
			algorithms: ['ES256'],
		});
	} catch {
		throw new AppError('signature_invalid');
	}
	return header;
}
