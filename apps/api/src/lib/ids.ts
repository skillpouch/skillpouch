// SPDX-License-Identifier: AGPL-3.0-only
import { randomBytes } from 'node:crypto';

/** UUIDv7 (RFC 9562): 48-bit Unix ms timestamp + random — time-ordered IDs (03). */
export function uuidv7(now = Date.now()): string {
	const bytes = randomBytes(16);
	bytes.writeUIntBE(now, 0, 6);
	bytes[6] = (bytes[6]! & 0x0f) | 0x70;
	bytes[8] = (bytes[8]! & 0x3f) | 0x80;
	const hex = bytes.toString('hex');
	return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
