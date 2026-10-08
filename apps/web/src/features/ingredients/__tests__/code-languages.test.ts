// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { findLanguage, loadLanguage } from '../components/code-languages';

describe('code languages', () => {
	it('finds the language by extension or file name', () => {
		const name = (path: string) => findLanguage(path)?.name ?? null;
		expect(name('scripts/run.py')).toBe('Python');
		expect(name('src/index.ts')).toBe('TypeScript');
		expect(name('SKILL.md')).toBe('Markdown');
		expect(name('.mcp.json')).toBe('JSON');
		expect(name('config.yaml')).toBe('YAML');
		expect(name('Dockerfile')).toBe('Dockerfile');
		expect(name('install.sh')).toBe('Shell');
	});

	it('knows the formats AI tools use that the list does not', () => {
		expect(findLanguage('.cursor/rules/style.mdc')?.name).toBe('Markdown');
		expect(findLanguage('settings.jsonc')?.name).toBe('JSON');
		expect(findLanguage('notes.txt')).toBeNull();
	});

	it('loads a parser, or plain text when there is none', async () => {
		const python = await loadLanguage('main.py');
		expect(python.name).toBe('Python');
		expect(python.support).not.toBeNull();
		expect(await loadLanguage('LICENSE')).toEqual({ name: 'Plain text', support: null });
	});
});
