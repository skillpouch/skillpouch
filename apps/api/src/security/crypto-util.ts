// SPDX-License-Identifier: AGPL-3.0-only
/** Small hashing helpers used across security code. */
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { blake3 } from '@noble/hashes/blake3.js';

export function sha256(data: string | Uint8Array): Buffer {
	return createHash('sha256').update(data).digest();
}

export function blake3Hash(data: Uint8Array): Buffer {
	return Buffer.from(blake3(data));
}

/** Keyed hash of an IP address: lets us compare IPs without storing them. */
export function hashIp(secret: string, ip: string): Buffer {
	return createHmac('sha256', secret).update(`ip:${ip}`).digest();
}

export function randomToken(bytes = 32): string {
	return randomBytes(bytes).toString('base64url');
}

/** Constant-time comparison of two byte strings. */
export function bytesEqualBuffers(a: Uint8Array, b: Uint8Array): boolean {
	return a.length === b.length && timingSafeEqual(a, b);
}
