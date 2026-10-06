// SPDX-License-Identifier: AGPL-3.0-only
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { open, unb64, utf8 } from '../src';
import { computeVectors } from '../src/vectors';

const committed = JSON.parse(
	readFileSync(join(import.meta.dirname, '..', 'vectors', 'v1.json'), 'utf8'),
);

describe('format v1 test vectors', () => {
	it('this implementation reproduces the committed vectors exactly', async () => {
		expect(await computeVectors()).toEqual(committed);
	});

	it('the committed sealed blob opens with the committed key', () => {
		const plaintext = open(
			unb64(committed.pouch_keys.k_content),
			unb64(committed.blob.sealed),
			utf8(committed.blob.aad_utf8),
		);
		expect(plaintext).toEqual(unb64(committed.blob.plaintext));
	});
});
