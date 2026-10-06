// SPDX-License-Identifier: AGPL-3.0-only
import { z } from 'zod';
import { Limits } from '../limits';

/** UUID in canonical text form (UUIDv7 for IDs we mint, v4 for request IDs). */
export const Uuid = z.uuid();

/** Unpadded base64url text. */
export const B64Url = z.string().regex(/^[A-Za-z0-9_-]*$/, 'must be unpadded base64url');

/** Base64url of exactly `bytes` bytes. */
export function b64urlBytes(bytes: number) {
	const length = Math.ceil((bytes * 4) / 3);
	return z.string().regex(new RegExp(`^[A-Za-z0-9_-]{${length}}$`), `must be ${bytes} bytes`);
}

/** Base64url whose decoded length is at most `maxBytes`. */
export function b64urlMax(maxBytes: number) {
	return B64Url.max(Math.ceil((maxBytes * 4) / 3));
}

/** 32-byte hash / keyed BLAKE3 identifier, base64url. */
export const Hash32 = b64urlBytes(32);
/** Keyed BLAKE3 blob identifier. */
export const BlobId = Hash32;

export const Timestamp = z.iso.datetime({ offset: true });

/** P-256 public key as JWK (RFC 7517). Extra members such as `ext` are stripped. */
export const P256PublicJwk = z.object({
	kty: z.literal('EC'),
	crv: z.literal('P-256'),
	x: b64urlBytes(32),
	y: b64urlBytes(32),
});
export type P256PublicJwk = z.infer<typeof P256PublicJwk>;

export const KeyStorage = z.enum(['tpm', 'secure_enclave', 'os_keystore', 'file']);
export const DeviceOs = z.enum(['linux', 'macos', 'windows']);

export const PageQuery = z.object({
	cursor: z.string().max(200).optional(),
	limit: z.coerce.number().int().min(1).max(Limits.pageMax).default(50),
});

export const IdParam = z.object({ id: Uuid });
export const PouchParam = z.object({ pouchId: Uuid });
