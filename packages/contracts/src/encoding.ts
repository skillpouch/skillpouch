// SPDX-License-Identifier: AGPL-3.0-only
/** Byte helpers shared by every side. Base64url is always unpadded. */

export function toBase64Url(bytes: Uint8Array): string {
	return Buffer.from(bytes).toString('base64url');
}

export function fromBase64Url(text: string): Uint8Array {
	return new Uint8Array(Buffer.from(text, 'base64url'));
}

export function toHex(bytes: Uint8Array): string {
	return Buffer.from(bytes).toString('hex');
}

/** Constant-time equality for secrets and hashes. */
export function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
	if (a.length !== b.length) return false;
	let diff = 0;
	for (let i = 0; i < a.length; i++) diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
	return diff === 0;
}
