// SPDX-License-Identifier: AGPL-3.0-only
import { blake3 } from '@noble/hashes/blake3.js';

/**
 * Deterministic JSON: object keys sorted by UTF-16 code unit order, no
 * whitespace, no `undefined`. Used for request digests (04 §3, receipts) and
 * roster statements so the CLI (Rust), the browser and the API hash the
 * exact same bytes.
 */
export function canonicalJson(value: unknown): string {
	if (value === null || typeof value === 'boolean' || typeof value === 'string') {
		return JSON.stringify(value);
	}
	if (typeof value === 'number') {
		if (!Number.isFinite(value)) throw new TypeError('canonicalJson: non-finite number');
		return JSON.stringify(value);
	}
	if (Array.isArray(value)) {
		return `[${value.map((item) => canonicalJson(item === undefined ? null : item)).join(',')}]`;
	}
	if (typeof value === 'object') {
		const entries = Object.entries(value as Record<string, unknown>)
			.filter(([, v]) => v !== undefined)
			.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
		return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
	}
	throw new TypeError(`canonicalJson: unsupported type ${typeof value}`);
}

/** BLAKE3-256 of the canonical JSON encoding. */
export function canonicalDigest(value: unknown): Uint8Array {
	return blake3(new TextEncoder().encode(canonicalJson(value)));
}
