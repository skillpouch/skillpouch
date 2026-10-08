// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import {
	asText,
	describe as describeFile,
	fillSecrets,
	languageOf,
	stripSecrets,
} from '../content';
import { KINDS, kindBySlug, validateName, validatePath } from '../kinds';

describe('asText', () => {
	it('decodes UTF-8 and rejects binary', () => {
		expect(asText(new TextEncoder().encode('héllo'))).toBe('héllo');
		expect(asText(new Uint8Array([0x68, 0, 0x69]))).toBeNull();
		expect(asText(new Uint8Array([0xff, 0xfe, 0xfd]))).toBeNull();
	});
});

describe('describe', () => {
	it('prefers frontmatter, then JSON, then the first paragraph line', () => {
		expect(describeFile('SKILL.md', '---\nname: x\ndescription: "Does PDFs"\n---\n# x')).toBe(
			'Does PDFs',
		);
		expect(describeFile('server.json', '{"description":" Postgres "}')).toBe('Postgres');
		expect(describeFile('server.json', '{broken')).toBe('');
		expect(describeFile('A.md', '# Title\n\n```\ncode\n```\nFirst line.\n')).toBe(
			'First line.',
		);
		expect(describeFile('A.md', null)).toBe('');
		expect(describeFile('A.md', 'x'.repeat(300))).toHaveLength(158);
	});
});

describe('languageOf', () => {
	it('maps extensions', () => {
		expect(languageOf('README.MD')).toBe('markdown');
		expect(languageOf('a.jsonc')).toBe('json');
		expect(languageOf('run.sh')).toBe('shell');
		expect(languageOf('Makefile')).toBe('text');
	});
});

describe('secret stripping', () => {
	const server = JSON.stringify({
		command: 'npx',
		env: { API_KEY: 'sk-live', REGION: 'eu' },
		nested: [{ headers: { Authorization: 'Bearer t' } }],
	});

	it('empties env/headers values and reports their keys', () => {
		const { text, stripped } = stripSecrets(server, ['env', 'headers']);
		expect(text).not.toContain('sk-live');
		expect(text).not.toContain('Bearer t');
		expect(stripped).toEqual(['env.API_KEY', 'env.REGION', 'nested.0.headers.Authorization']);
		expect(JSON.parse(text).command).toBe('npx');
	});

	it('fills recipient values back in and ignores unknown paths', () => {
		const { text } = stripSecrets(server, ['env', 'headers']);
		const filled = JSON.parse(
			fillSecrets(text, { 'env.API_KEY': 'mine', 'missing.path.key': 'x' }),
		);
		expect(filled.env).toEqual({ API_KEY: 'mine', REGION: '' });
		expect(filled.missing).toBeUndefined();
	});

	it('leaves non-JSON files untouched', () => {
		expect(stripSecrets('not json', ['env'])).toEqual({ text: 'not json', stripped: [] });
		expect(fillSecrets('not json', { a: 'b' })).toBe('not json');
	});
});

describe('kinds', () => {
	it('every kind has a unique slug, and a template that names the item unless the name is fixed', () => {
		const slugs = new Set(KINDS.map((kind) => kind.slug));
		expect(slugs.size).toBe(KINDS.length);
		for (const kind of KINDS) {
			expect(kindBySlug(kind.slug)).toBe(kind);
			if (!kind.single) expect(kind.template('zz-name')).toContain('zz-name');
			if (kind.mainFile.endsWith('.json')) {
				expect(() => JSON.parse(kind.template('zz-name'))).not.toThrow();
			}
		}
	});

	it('validates portable names and paths', () => {
		expect(validateName('pdf-tools_2.1')).toBeNull();
		expect(validateName('')).toMatch(/name/);
		expect(validateName('-lead')).toMatch(/Start/);
		expect(validateName('a b')).toMatch(/letters/);
		expect(validateName('a'.repeat(65))).toMatch(/64/);
		expect(validatePath('docs/a.md')).toBeNull();
		expect(validatePath('con<.md')).toMatch(/characters/);
		expect(validatePath('a'.repeat(256))).toMatch(/long/);
	});
});
