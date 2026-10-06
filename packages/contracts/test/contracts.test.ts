// SPDX-License-Identifier: AGPL-3.0-only
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
	CommitRequest,
	ErrorCodes,
	canonicalDigest,
	canonicalJson,
	errorDocsUrl,
	fromBase64Url,
	parseSealedHeader,
	toBase64Url,
	toHex,
} from '../src/index';
import { renderGeneratedFiles } from '../src/generated-files';

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

describe('error registry', () => {
	it('uses lower_snake_case codes and valid HTTP statuses', () => {
		for (const [code, def] of Object.entries(ErrorCodes)) {
			expect(code).toMatch(/^[a-z][a-z0-9_]*$/);
			expect(def.status).toBeGreaterThanOrEqual(400);
			expect(def.status).toBeLessThan(600);
			expect(def.message.length).toBeGreaterThan(0);
		}
	});

	it('links every code to its docs page', () => {
		expect(errorDocsUrl('not_found')).toBe('https://docs.skillpouch.net/errors/not_found');
	});

	it('has committed generated files that match the registry', () => {
		for (const [relativePath, content] of Object.entries(renderGeneratedFiles())) {
			const committed = readFileSync(join(packageRoot, relativePath), 'utf8');
			expect(committed, `${relativePath} is stale; run pnpm contracts:generate`).toBe(
				content,
			);
		}
	});
});

describe('canonical JSON', () => {
	it('sorts keys recursively and drops undefined', () => {
		expect(canonicalJson({ b: 1, a: [{ d: true, c: null }], e: undefined })).toBe(
			'{"a":[{"c":null,"d":true}],"b":1}',
		);
	});

	it('is independent of key insertion order', () => {
		expect(canonicalJson({ x: 1, y: 2 })).toBe(canonicalJson({ y: 2, x: 1 }));
	});

	it('rejects non-finite numbers', () => {
		expect(() => canonicalJson({ n: Number.NaN })).toThrow(TypeError);
	});

	it('hashes with BLAKE3 (shared vector with the CLI)', () => {
		// BLAKE3("{}") — the CLI's contract test uses the same vector.
		expect(toHex(canonicalDigest({}))).toBe(
			'6e46dd10defc9b56c29a6ec56b508c21f54c08192194e4df25bf36f0c9c3c279',
		);
		expect(canonicalDigest({ a: 1 })).toHaveLength(32);
	});
});

describe('base64url helpers', () => {
	it('round-trips bytes without padding', () => {
		const bytes = new Uint8Array([0, 1, 250, 251, 252, 253, 254, 255]);
		const text = toBase64Url(bytes);
		expect(text).not.toContain('=');
		expect(fromBase64Url(text)).toEqual(bytes);
	});
});

describe('sealed object header', () => {
	function sealed(format: number, keyGen: number, bodyBytes = 16): Uint8Array {
		const bytes = new Uint8Array(1 + 4 + 24 + bodyBytes);
		bytes[0] = format;
		new DataView(bytes.buffer).setUint32(1, keyGen, false);
		return bytes;
	}

	it('parses format and key generation', () => {
		expect(parseSealedHeader(sealed(1, 7))).toEqual({ format: 1, keyGen: 7 });
	});

	it('rejects unknown formats, generation 0 and truncated objects', () => {
		expect(parseSealedHeader(sealed(2, 1))).toBeNull();
		expect(parseSealedHeader(sealed(1, 0))).toBeNull();
		expect(parseSealedHeader(sealed(1, 1, 3))).toBeNull();
	});
});

describe('schemas', () => {
	it('rejects unknown fields in commit requests', () => {
		const result = CommitRequest.safeParse({
			operation_id: '0192f1a0-0000-7000-8000-000000000000',
			epoch: '0192f1a0-0000-7000-8000-000000000001',
			ops: [],
			extra: true,
		});
		expect(result.success).toBe(false);
	});
});
