// SPDX-License-Identifier: AGPL-3.0-only
import { b64 } from '@skillpouch/crypto';
import { describe, expect, it } from 'vitest';
import { bundleFiles, freeName } from '../import';
import { keyFromHash } from '../shares';

describe('freeName', () => {
	it('appends the first free number, case-insensitively', () => {
		expect(freeName('pdf', new Set())).toBe('pdf');
		expect(freeName('PDF', new Set(['pdf', 'pdf-2']))).toBe('PDF-3');
	});
});

describe('keyFromHash', () => {
	it('reads the key only from the fragment', () => {
		const key = `${'A'.repeat(41)}_-`;
		expect(keyFromHash(`#key=${key}`)).toBe(key);
		expect(keyFromHash('#key=short')).toBeNull();
		expect(keyFromHash(`#key=${'A'.repeat(42)}!`)).toBeNull();
		expect(keyFromHash('')).toBeNull();
		expect(keyFromHash('#other=1')).toBeNull();
	});
});

describe('bundleFiles', () => {
	it('fills stripped secrets per file and keeps other files as they are', () => {
		const encode = (text: string) => b64(new TextEncoder().encode(text));
		const files = bundleFiles(
			{
				format: 1,
				kind: 'mcp_server',
				name: 'pg',
				description: '',
				files: [
					{ path: 'server.json', content: encode('{"env":{"URL":""}}'), mode: 'file' },
					{ path: 'README.md', content: encode('hi'), mode: 'file' },
				],
				stripped: ['server.json:env.URL'],
				shared_at: '2026-10-06T00:00:00Z',
			},
			{ 'server.json:env.URL': 'postgres://x', 'README.md:env.URL': 'ignored' },
		);
		const decode = (bytes: Uint8Array) => new TextDecoder().decode(bytes);
		expect(JSON.parse(decode(files[0]!.bytes)).env.URL).toBe('postgres://x');
		expect(decode(files[1]!.bytes)).toBe('hi');
	});
});
