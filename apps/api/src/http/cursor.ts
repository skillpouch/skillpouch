// SPDX-License-Identifier: AGPL-3.0-only
/** Opaque cursor encoding for keyset pagination. */
export function encodeCursor(value: string | number): string {
	return Buffer.from(String(value)).toString('base64url');
}

export function decodeCursor(cursor: string | undefined): string | undefined {
	return cursor === undefined ? undefined : Buffer.from(cursor, 'base64url').toString('utf8');
}
