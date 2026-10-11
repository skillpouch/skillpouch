// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { asText, describe as describeFile, fillSecrets, stripSecrets } from '../content';
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

	it('strips setting secrets by names, maps, token heuristics, proxy auth, and dotted identifiers', () => {
		const source = JSON.stringify({
			harness: 'opencode',
			files: {
				'opencode.json': {
					providers: {
						'company.internal': {
							settings: { apiKey: 'literal', baseURL: 'https://host' },
						},
					},
					proxy: 'http://user:pass@proxy.example',
					header: 'Bearer abc',
					ordinary: 'ghp_abcdef',
				},
				'tui.json': { headers: { 'X-Auth': 'anything', nested: { value: 'also secret' } } },
				'.env': { GEMINI_API_KEY: 'AIzaabc', OTHER: 'private-value' },
			},
		});
		const { text, stripped } = stripSecrets(source, [], true);
		const clean = JSON.parse(text);
		expect(clean.files['opencode.json'].providers['company.internal'].settings.apiKey).toBe('');
		expect(clean.files['opencode.json'].proxy).toBe('');
		expect(clean.files['opencode.json'].header).toBe('');
		expect(clean.files['opencode.json'].ordinary).toBe('');
		expect(clean.files['opencode.json'].baseURL).toBeUndefined();
		expect(clean.files['tui.json'].headers.nested.value).toBe('');
		expect(clean.files['.env'].GEMINI_API_KEY).toBe('');
		expect(stripped).toContain(
			'@setting:/files/opencode.json/providers/company.internal/settings/apiKey',
		);
		expect(stripped).toContain('@setting:/files/.env/OTHER');
		const filled = JSON.parse(
			fillSecrets(text, {
				'@setting:/files/opencode.json/providers/company.internal/settings/apiKey':
					'restored',
			}),
		);
		expect(filled.files['opencode.json'].providers['company.internal'].settings.apiKey).toBe(
			'restored',
		);
	});

	it('keeps legacy dotted MCP secret paths working', () => {
		const filled = JSON.parse(
			fillSecrets('{"env":{"API_KEY":""}}', { 'env.API_KEY': 'legacy' }),
		);
		expect(filled.env.API_KEY).toBe('legacy');
	});

	it('recognizes credential key variants and common token formats', () => {
		const keys = [
			'apiKey',
			'api_key',
			'apikey',
			'key',
			'token',
			'access_token',
			'refresh_token',
			'secret',
			'client_secret',
			'password',
			'passwd',
			'bearer',
			'experimental_bearer_token',
			'authorization',
			'auth_token',
			'credential',
			'credentials',
			'private_key',
			'customApiKey',
		];
		const values = Object.fromEntries(keys.map((key) => [key, 'value']));
		Object.assign(values, {
			a: 'sk-live',
			b: 'sk_live',
			c: 'gho_live',
			d: 'ghu_live',
			e: 'github_pat_live',
			f: 'xoxb-live',
			g: 'glpat-live',
			h: 'AIza-live',
			i: `eyJ${'a'.repeat(8)}.${'b'.repeat(8)}.${'c'.repeat(8)}`,
			j: 'a1'.repeat(16),
			keep: 'https://example.com/path',
		});
		const cleaned = JSON.parse(
			stripSecrets(JSON.stringify({ files: { config: values } }), [], true).text,
		);
		for (const key of [...keys, 'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j']) {
			expect(cleaned.files.config[key], key).toBe('');
		}
		expect(cleaned.files.config.keep).toBe('https://example.com/path');
	});
});

describe('kinds', () => {
	it('every kind has a unique slug, and a template that names the item unless the name is fixed', () => {
		const slugs = new Set(KINDS.map((kind) => kind.slug));
		expect(slugs.size).toBe(KINDS.length);
		// The pouch's fixed pages would win over a kind list with the same path.
		for (const page of ['shared', 'conflicts', 'settings', 'marketplaces']) {
			expect(slugs.has(page), page).toBe(false);
		}
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
