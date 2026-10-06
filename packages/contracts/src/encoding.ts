// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Byte helpers shared by every side (API, browser, Node tools). Base64url is
 * always unpadded. Written without `Buffer` so the same code runs in browsers.
 */

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const LOOKUP = new Int16Array(128).fill(-1);
for (let i = 0; i < ALPHABET.length; i++) LOOKUP[ALPHABET.charCodeAt(i)] = i;

export function toBase64Url(bytes: Uint8Array): string {
	let out = '';
	let i = 0;
	for (; i + 2 < bytes.length; i += 3) {
		const n = (bytes[i]! << 16) | (bytes[i + 1]! << 8) | bytes[i + 2]!;
		out +=
			ALPHABET[(n >> 18) & 63]! +
			ALPHABET[(n >> 12) & 63]! +
			ALPHABET[(n >> 6) & 63]! +
			ALPHABET[n & 63]!;
	}
	const rest = bytes.length - i;
	if (rest === 1) {
		const n = bytes[i]! << 16;
		out += ALPHABET[(n >> 18) & 63]! + ALPHABET[(n >> 12) & 63]!;
	} else if (rest === 2) {
		const n = (bytes[i]! << 16) | (bytes[i + 1]! << 8);
		out += ALPHABET[(n >> 18) & 63]! + ALPHABET[(n >> 12) & 63]! + ALPHABET[(n >> 6) & 63]!;
	}
	return out;
}

/**
 * Decodes unpadded base64url. Characters outside the alphabet end the input
 * (like Node's decoder), so callers that need strictness validate the text
 * with a schema first.
 */
export function fromBase64Url(text: string): Uint8Array {
	let end = 0;
	while (end < text.length) {
		const code = text.charCodeAt(end);
		if (code >= 128 || LOOKUP[code] === -1) break;
		end++;
	}
	const out = new Uint8Array(Math.floor((end * 3) / 4));
	let bits = 0;
	let value = 0;
	let o = 0;
	for (let i = 0; i < end; i++) {
		value = (value << 6) | LOOKUP[text.charCodeAt(i)]!;
		bits += 6;
		if (bits >= 8) {
			bits -= 8;
			out[o++] = (value >> bits) & 0xff;
		}
	}
	return out;
}

export function toHex(bytes: Uint8Array): string {
	let out = '';
	for (const byte of bytes) out += byte.toString(16).padStart(2, '0');
	return out;
}

/** Constant-time equality for secrets and hashes. */
export function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
	if (a.length !== b.length) return false;
	let diff = 0;
	for (let i = 0; i < a.length; i++) diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
	return diff === 0;
}
